import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CloudflareError, createCloudflare } from "../server/cloudflare-api.js";
// Cloudflare 자동 생성 (specs/001-easy-domain-setup research R2): responses are the documented shapes in
// tests/fixtures/cloudflare-fixtures.json; a fake fetch routes by method and path and records every call.
const fx = JSON.parse(readFileSync("tests/fixtures/cloudflare-fixtures.json", "utf8")) as Record<string, unknown>;
const TOKEN = "synthetic-cf-token-" + "x".repeat(20);
type Call = { method: string; path: string; body?: unknown; auth?: string };
function api(routes: Record<string, unknown | ((c: Call) => unknown)>) {
  const calls: Call[] = [];
  const fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url)), path = u.pathname.replace("/client/v4", "") + u.search;
    const c: Call = { method: init?.method ?? "GET", path, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: (init?.headers as Record<string, string>).authorization };
    assert.ok(init?.signal, "every call has a timeout");
    calls.push(c);
    const key = Object.keys(routes).find((k) => `${c.method} ${path}`.startsWith(k));
    if (!key) return new Response(JSON.stringify({ success: false, errors: [{ code: 7003, message: "No route" }], result: null }), { status: 404 });
    const v = routes[key], body = typeof v === "function" ? (v as (c: Call) => unknown)(c) : v;
    return new Response(JSON.stringify(body), { status: (body as { success: boolean }).success ? 200 : 400 });
  }) as typeof globalThis.fetch;
  return { calls, cf: createCloudflare(TOKEN, fetch) };
}
const ok = (result: unknown) => ({ success: true, errors: [], messages: [], result });
test("cloudflare: token check, zone lookup from the right-most labels", async () => {
  const good = api({ "GET /user/tokens/verify": fx.verify, "GET /zones?name=test&": ok([]), "GET /zones?name=example.test&": fx.zones });
  await good.cf.verify();
  assert.deepEqual(await good.cf.findZone("safety.example.test"), { zoneId: "023e105f4ecef8ad9ca31a8372d0c353", accountId: "a1b2c3d4e5f60718293a4b5c6d7e8f90", zone: "example.test" });
  assert.ok(good.calls.every((c) => c.auth === `Bearer ${TOKEN}`));
  const bad = api({ "GET /user/tokens/verify": fx.invalidToken });
  await assert.rejects(bad.cf.verify(), (e: Error) => e instanceof CloudflareError && e.message === "Cloudflare 응답: Invalid API Token" && !e.message.includes(TOKEN));
  const expired = api({ "GET /user/tokens/verify": ok({ id: "x", status: "expired" }) });
  await assert.rejects(expired.cf.verify(), /expired/);
  const none = api({ "GET /zones": ok([]) });
  assert.equal(await none.cf.findZone("safety.example.co.kr"), null);
  assert.deepEqual(none.calls.map((c) => c.path), ["/zones?name=co.kr&status=active", "/zones?name=example.co.kr&status=active", "/zones?name=safety.example.co.kr&status=active"]);
  const down = createCloudflare(TOKEN, (async () => { throw new Error("ENOTFOUND"); }) as never);
  await assert.rejects(down.verify(), /Cloudflare에 연결하지 못했습니다/);
});
test("cloudflare: tunnel, ingress and token are created once and reused after", async () => {
  const acc = "a1b2c3d4e5f60718293a4b5c6d7e8f90", id = "f70ff985-a4ef-4643-bbbc-4a0ed4fc8415";
  let tunnels: unknown[] = [];
  const { calls, cf } = api({
    "GET /accounts/": (c: Call) => (c.path.endsWith("/token") ? fx.token : ok(tunnels)),
    "POST /accounts/": () => { tunnels = [(fx.tunnelCreate as { result: unknown }).result]; return fx.tunnelCreate; },
    "PUT /accounts/": fx.config,
  });
  assert.deepEqual(await cf.ensureTunnel(acc, "yweb-safety.example.test"), { id, created: true });
  assert.deepEqual(await cf.ensureTunnel(acc, "yweb-safety.example.test"), { id, created: false });
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
  assert.deepEqual(calls.find((c) => c.method === "POST")!.body, { name: "yweb-safety.example.test", config_src: "cloudflare" });
  // a tunnel whose name only starts the same is not ours
  tunnels = [{ id: "other", name: "yweb-safety.example.test-old" }];
  assert.equal((await cf.ensureTunnel(acc, "yweb-safety.example.test")).created, true);
  await cf.putIngress(acc, id, "safety.example.test", 3000);
  assert.deepEqual(calls.find((c) => c.method === "PUT")!.body, { config: { ingress: [{ hostname: "safety.example.test", service: "http://127.0.0.1:3000" }, { service: "http_status:404" }] } });
  assert.equal(await cf.tunnelToken(acc, id), "eyJhIjoiNWFiNGU5Z-synthetic");
});
test("cloudflare: DNS is looked up first; same value reused, another value is a conflict until overwrite", async () => {
  const zone = "023e105f4ecef8ad9ca31a8372d0c353", cname = { type: "CNAME" as const, name: "safety.example.test", content: "f70ff985-a4ef-4643-bbbc-4a0ed4fc8415.cfargotunnel.com", proxied: true };
  let records: { id: string; type: string; name: string; content: string; proxied: boolean }[] = [];
  const { calls, cf } = api({
    "GET /zones/": () => ok(records),
    "POST /zones/": (c: Call) => { records = [{ id: "new", ...(c.body as typeof cname) }]; return fx.dnsCreate; },
    "DELETE /zones/": (c: Call) => { records = records.filter((r) => !c.path.endsWith(r.id)); return ok({ id: "gone" }); },
  });
  assert.deepEqual(await cf.ensureDns(zone, cname), { status: "created" });
  assert.deepEqual(calls.find((c) => c.method === "POST")!.body, { ...cname, ttl: 1 });
  assert.deepEqual(await cf.ensureDns(zone, cname), { status: "reused" });
  records = [{ id: "old", type: "A", name: cname.name, content: "198.51.100.7", proxied: true }];
  assert.deepEqual(await cf.ensureDns(zone, cname), { status: "conflict", current: "A 198.51.100.7 (프록시)" });
  assert.equal(calls.filter((c) => c.method === "DELETE").length, 0);
  assert.deepEqual(await cf.ensureDns(zone, cname, true), { status: "replaced" });
  assert.equal(calls.filter((c) => c.method === "DELETE").length, 1);
  // direct connection: an A record must not be proxied, or Let's Encrypt http-01 goes to Cloudflare instead of this PC
  records = [{ id: "a1", type: "A", name: cname.name, content: "203.0.113.5", proxied: true }];
  assert.equal((await cf.ensureDns(zone, { type: "A", name: cname.name, content: "203.0.113.5", proxied: false })).status, "conflict");
});
