import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { publicOrigin, readPublicSettings, type PublicRuntime } from "../server/public-access.js";
import { ensureCertificate, findCloudflared, redirectApp, startTunnel } from "../server/public-serve.js";
const origin = "http://127.0.0.1:3000", secret = "synthetic-public-secret-".repeat(3), pub = "https://safety.example.test";
async function fixture(extra: { publicOrigin?: string; trustProxy?: boolean; publicRuntime?: PublicRuntime } = {}) {
  const db = openDatabase(":memory:"), password = randomUUID(), id = randomUUID();
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(id, "owner@example.test", "owner", await argon2.hash(password));
  const app = await createApp(db, { origin, secret, ...extra });
  const agent = request.agent(app);
  let r = await agent.get("/api/session");
  r = await agent.post("/api/login").set("Origin", origin).set("x-csrf-token", r.body.csrf).send({ email: "owner@example.test", password });
  const csrf = r.body.csrf as string;
  const put = (body: object, headers: Record<string, string> = {}) => {
    let q = agent.put("/api/public-access").set("Origin", origin).set("x-csrf-token", csrf);
    for (const [k, v] of Object.entries(headers)) q = q.set(k, v);
    return q.send(body);
  };
  return { db, app, agent, put, password };
}
const base = { mode: "off", domain: "", email: "", agreeTos: false, tunnelToken: "" };
test("internet access settings: this PC only, validated, tunnel token sealed and never shown", async () => {
  const f = await fixture();
  try {
    let s = (await f.agent.get("/api/public-access")).body;
    assert.deepEqual([s.canManage, s.settings.mode, s.runtime.state, s.restartNeeded], [true, "off", "꺼짐", false]);
    assert.equal((await f.put({ ...base, mode: "direct", domain: "safety.example.test", email: "o@example.test", agreeTos: true }, { Host: "safety.example.test" })).status, 403);
    assert.equal((await f.put({ ...base, mode: "direct", domain: "safety.example.test", email: "o@example.test", agreeTos: true }, { "cf-connecting-ip": "203.0.113.5" })).status, 403);
    assert.equal((await f.put({ ...base, mode: "direct", domain: "safety.example.test", email: "o@example.test" })).status, 400); // terms not agreed
    for (const domain of ["127.0.0.1", "localhost", "*.example.test", "bad domain.test"]) assert.equal((await f.put({ ...base, mode: "direct", domain, email: "o@example.test", agreeTos: true })).status, 400, domain);
    assert.equal((await f.put({ ...base, mode: "tunnel", domain: "safety.example.test" })).status, 400); // token required
    const token = "eyJ-synthetic-tunnel-token-" + "t".repeat(40) + "ABCD";
    assert.equal((await f.put({ ...base, mode: "tunnel", domain: "Safety.Example.test", tunnelToken: token })).status, 200);
    assert.ok(!JSON.stringify(f.db.prepare("SELECT * FROM public_access").all()).includes(token), "token must be sealed at rest");
    s = (await f.agent.get("/api/public-access")).body;
    assert.deepEqual([s.settings.mode, s.settings.domain, s.settings.tunnelHint, s.restartNeeded], ["tunnel", "safety.example.test", "…ABCD", true]);
    assert.ok(!JSON.stringify(s).includes(token));
    // Switching mode without retyping keeps the stored token.
    assert.equal((await f.put({ ...base, mode: "tunnel", domain: "safety.example.test" })).status, 200);
    const read = readPublicSettings(f.db, secret);
    assert.deepEqual([read.tunnelToken, publicOrigin(read)], [token, pub]);
    assert.equal(readPublicSettings(f.db, "another-synthetic-secret-".repeat(2)).tunnelToken, undefined);
    // Seen from outside: status only, no settings.
    s = (await f.agent.get("/api/public-access").set("Host", "safety.example.test")).body;
    assert.deepEqual([s.canManage, s.settings], [false, null]);
  } finally { f.db.close(); }
});
test("serving a public domain: its https origin passes CSRF, cookies turn Secure behind the tunnel, HSTS on", async () => {
  const runtime: PublicRuntime = { mode: "tunnel", origin: pub, state: "실행 중" };
  const f = await fixture({ publicOrigin: pub, trustProxy: true, publicRuntime: runtime });
  try {
    assert.match((await f.agent.get("/api/session")).headers["strict-transport-security"] ?? "", /max-age=15552000/);
    assert.deepEqual((await f.agent.get("/api/public-origin")).body, { origin: pub });
    // A phone reaches cloudflared over https; cloudflared calls this app over loopback http with X-Forwarded-Proto: https.
    // supertest will not resend a Secure cookie over http, so the cookie is carried by hand like the browser would.
    const viaTunnel = (q: request.Test, cookie?: string) => (cookie ? q.set("Cookie", cookie) : q).set("X-Forwarded-Proto", "https").set("X-Forwarded-For", "198.51.100.7");
    let r = await viaTunnel(request(f.app).get("/api/session"));
    assert.match(String(r.headers["set-cookie"]), /Secure/);
    const cookie = String(r.headers["set-cookie"]).split(";")[0];
    r = await viaTunnel(request(f.app).post("/api/login"), cookie).set("Origin", pub).set("x-csrf-token", r.body.csrf).send({ email: "owner@example.test", password: f.password });
    assert.equal(r.status, 200, r.text);
    const session = String(r.headers["set-cookie"] ?? cookie).split(";")[0];
    r = await viaTunnel(request(f.app).post("/api/logout"), session).set("Origin", "https://evil.example.test").set("x-csrf-token", r.body.csrf).send({});
    assert.equal(r.status, 403);
    assert.equal((await f.put(base, { "X-Forwarded-For": "198.51.100.7" })).status, 403); // proxied requests are never "this PC"
  } finally { f.db.close(); }
  const local = await fixture();
  try {
    assert.equal((await local.agent.get("/api/session")).headers["strict-transport-security"], undefined);
    assert.doesNotMatch(String((await request(local.app).get("/api/session")).headers["set-cookie"]), /Secure/);
    assert.deepEqual((await local.agent.get("/api/public-origin")).body, { origin: null });
  } finally { local.db.close(); }
});
test("direct mode: ACME http-01 answers from memory, everything else redirects to https", async () => {
  const challenges = new Map([["tok123", "tok123.keyauth"]]), app = redirectApp("safety.example.test", challenges, 443);
  let r = await request(app).get("/.well-known/acme-challenge/tok123");
  assert.deepEqual([r.status, r.text], [200, "tok123.keyauth"]);
  assert.equal((await request(app).get("/.well-known/acme-challenge/other")).status, 404);
  r = await request(app).get("/join?x=1");
  assert.deepEqual([r.status, r.headers.location], [301, "https://safety.example.test/join?x=1"]);
  assert.equal((await request(redirectApp("safety.example.test", challenges, 8443)).get("/")).headers.location, "https://safety.example.test:8443/");
});
test("certificates are reused until 30 days before expiry, then renewed; a new domain reissues", async () => {
  const dir = mkdtempSync(join(tmpdir(), "yweb-tls-")), day = 86400000, start = new Date("2026-11-01T00:00:00Z");
  let issued = 0;
  const issue = async () => { issued++; return { cert: `CERT${issued}`, key: `KEY${issued}` }; };
  const readNotAfter = (pem: string) => new Date(start.getTime() + 90 * day * Number(pem.slice(4))); // CERT1 → +90d, CERT2 → +180d
  const o = (now: Date, domain = "safety.example.test") => ensureCertificate({ domain, email: "o@example.test", dir, challenges: new Map(), issue, readNotAfter, now });
  try {
    assert.deepEqual([(await o(start)).renewed, issued], [true, 1]);
    assert.equal(readFileSync(join(dir, "cert.pem"), "utf8"), "CERT1");
    assert.deepEqual([(await o(new Date(start.getTime() + 59 * day))).renewed, issued], [false, 1]); // 31 days left
    assert.deepEqual([(await o(new Date(start.getTime() + 61 * day))).renewed, issued], [true, 2]); // 29 days left
    assert.deepEqual([(await o(new Date(start.getTime() + 61 * day), "other.example.test")).renewed, issued], [true, 3]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("tunnel: cloudflared gets the token by environment only, reconnects after exit, reports a missing install", async () => {
  type Call = { cmd: string; args: string[]; env: NodeJS.ProcessEnv };
  const calls: Call[] = [], kids: (EventEmitter & { stderr: EventEmitter; kill: () => void })[] = [];
  const spawnFn = ((cmd: string, args: string[], opts: { env: NodeJS.ProcessEnv }) => {
    calls.push({ cmd, args, env: opts.env });
    const c = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), kill: () => {} });
    kids.push(c);
    return c;
  }) as never;
  const runtime: PublicRuntime = { mode: "tunnel", origin: pub, state: "시작 중" }, token = "eyJ-secret-token";
  const t = startTunnel(token, runtime, { bin: "cloudflared", spawnFn, retryMs: 5 });
  assert.deepEqual(calls[0].args, ["tunnel", "--no-autoupdate", "run"]);
  assert.equal(calls[0].env.TUNNEL_TOKEN, token);
  assert.ok(!calls[0].args.join(" ").includes(token));
  kids[0].stderr.emit("data", Buffer.from("INF Registered tunnel connection connIndex=0"));
  assert.equal(runtime.state, "실행 중");
  kids[0].emit("exit", 1);
  assert.equal(runtime.state, "재연결 대기");
  await new Promise((ok) => setTimeout(ok, 30));
  assert.equal(calls.length, 2);
  t.close();
  const missing: PublicRuntime = { mode: "tunnel", state: "시작 중" };
  startTunnel(token, missing, { spawnFn, retryMs: 5 });
  kids.at(-1)!.emit("error", Object.assign(new Error("spawn cloudflared ENOENT"), { code: "ENOENT" }));
  kids.at(-1)!.emit("exit", -2);
  await new Promise((ok) => setTimeout(ok, 30));
  assert.equal(missing.state, "중지");
  assert.match(missing.detail ?? "", /cloudflared를 찾지 못했습니다/);
  assert.equal(calls.length, 3); // no retry loop when it is not installed
  assert.equal(findCloudflared({ CLOUDFLARED_PATH: "D:\\tools\\cloudflared.exe" }, () => false), "D:\\tools\\cloudflared.exe");
  assert.equal(findCloudflared({}, () => false), "cloudflared");
  assert.equal(findCloudflared({}, (p) => String(p).includes("(x86)")), "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe");
});
