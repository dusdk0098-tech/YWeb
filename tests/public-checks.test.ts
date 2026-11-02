import test from "node:test";
import assert from "node:assert/strict";
import { checkCloudflared, checkDns, checkFirewall, elevatedScript, runElevated, networkProfile, publicIp, reachabilityTest, reachReason, resetReachCache, type Run } from "../server/public-checks.js";
// 외부 접속 마법사 점검 (specs/001-easy-domain-setup research R3·R4·R9): every outside effect is a fake.
const now = () => new Date("2026-11-02T00:00:00Z");
const run = (code: number, stdout = "", missing = false): Run => async () => ({ code, stdout, missing });
test("checks: DNS against this PC's public IP", async () => {
  const r = (ips: string[]) => async () => ips;
  assert.deepEqual(await checkDns("safety.example.test", "203.0.113.5", { resolve: r(["203.0.113.5"]), now }), { status: "ok", reason: "도메인이 이 PC의 공인 IP를 가리킵니다.", current: "203.0.113.5", expected: "203.0.113.5", at: "2026-11-02T00:00:00.000Z" });
  const other = await checkDns("safety.example.test", "203.0.113.5", { resolve: r(["198.51.100.7"]), now });
  assert.deepEqual([other.status, other.current, other.expected], ["todo", "198.51.100.7", "203.0.113.5"]);
  assert.equal((await checkDns("safety.example.test", "203.0.113.5", { resolve: r([]), now })).status, "todo");
  assert.equal((await checkDns("safety.example.test", null, { resolve: r(["198.51.100.7"]), now })).status, "unknown");
});
test("checks: public IP from the router first, then Cloudflare's trace page", async () => {
  let fetched = 0;
  const trace = (async () => { fetched++; return new Response("fl=1\nh=www.cloudflare.com\nip=198.51.100.20\nts=1\n"); }) as never;
  assert.equal(await publicIp({ upnp: { externalIp: async () => "203.0.113.5" }, fetch: trace }), "203.0.113.5");
  assert.equal(fetched, 0);
  assert.equal(await publicIp({ upnp: { externalIp: async () => null }, fetch: trace }), "198.51.100.20");
  assert.equal(await publicIp({ fetch: (async () => new Response("ip=<script>")) as never }), null);
  assert.equal(await publicIp({ fetch: (async () => { throw new Error("offline"); }) as never }), null);
});
test("checks: Windows firewall rule, cloudflared, network profile", async () => {
  assert.equal((await checkFirewall({ run: run(0, "1\r\n"), platform: "win32", now })).status, "ok");
  assert.equal((await checkFirewall({ run: run(0, "0\r\n"), platform: "win32", now })).reason, "Windows 방화벽에 80·443 허용 규칙이 없습니다.");
  assert.equal((await checkFirewall({ run: run(1), platform: "win32", now })).status, "unknown");
  assert.equal((await checkFirewall({ run: run(0, "1"), platform: "linux", now })).status, "unknown");
  const seen: string[][] = [];
  await checkFirewall({ run: async (cmd, args) => { seen.push([cmd, ...args]); return { code: 0, stdout: "1" }; }, platform: "win32", now });
  assert.match(seen[0].join(" "), /Get-NetFirewallRule -DisplayName 'Y웹 HTTP\/HTTPS'/);
  assert.deepEqual(await checkCloudflared({ run: run(0, "cloudflared version 2026.7.3 (built 2026-07-20)\n"), bin: "cloudflared", now }), { status: "ok", reason: "cloudflared가 설치되어 있습니다.", current: "cloudflared version 2026.7.3 (built 2026-07-20)", at: "2026-11-02T00:00:00.000Z" });
  assert.equal((await checkCloudflared({ run: run(1, "", true), bin: "cloudflared", now })).reason, "cloudflared가 설치되어 있지 않습니다.");
  assert.equal(await networkProfile({ run: run(0, "Public\r\n"), platform: "win32" }), "Public");
  assert.equal(await networkProfile({ run: run(0, "Public"), platform: "darwin" }), null);
});
test("checks: reachability by a staging validation, with a temporary port-80 listener and a 30 s cooldown", async () => {
  resetReachCache();
  let listened = 0, closed = 0, issued = 0, t = now().getTime();
  const clock = () => new Date(t);
  const listen = async () => { listened++; return () => { closed++; }; };
  const ok = await reachabilityTest({ domain: "a.example.test", dir: "unused", listen, issue: async (_d, _e, _dir, challenges) => { issued++; assert.ok(challenges instanceof Map); return { cert: "", key: "" }; }, now: clock });
  assert.deepEqual([ok.status, listened, closed, issued], ["ok", 1, 1, 1]);
  t += 10_000;
  assert.equal((await reachabilityTest({ domain: "a.example.test", dir: "unused", listen, issue: async () => { throw new Error("must use the cached result"); }, now: clock })).status, "ok");
  t += 30_000;
  const failed = await reachabilityTest({ domain: "a.example.test", dir: "unused", listen, issue: async () => { throw new Error('Verify error: 203.0.113.5: Fetching http://a.example.test/.well-known/acme-challenge/x: Connection refused'); }, now: clock });
  assert.deepEqual([failed.status, failed.reason, closed], ["todo", "밖에서 80 포트로 접속이 거부됐습니다. 공유기 포트포워딩을 확인하세요.", 2]); // the cached call opened no listener
  const busy = await reachabilityTest({ domain: "b.example.test", dir: "unused", listen: async () => { throw Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" }); }, now: clock });
  assert.equal(busy.status, "unknown");
  assert.match(busy.reason, /80 포트를 다른 프로그램이 쓰고 있습니다/);
  assert.equal(reachReason("DNS problem: NXDOMAIN looking up A for a.example.test").status, "todo");
  assert.match(reachReason("Timeout during connect (likely firewall problem)").reason, /닿지 않습니다/);
  assert.equal(reachReason("urn:ietf:params:acme:error:rateLimited: too many failed authorizations").status, "unknown");
});
test("checks: elevated command goes base64 into a UAC wrapper that turns a declined prompt into 1223", async () => {
  const cmd = "New-NetFirewallRule -DisplayName 'Y웹 HTTP/HTTPS' -Direction Inbound -Protocol TCP -LocalPort 80,443 -Action Allow";
  const script = elevatedScript(cmd), b64 = /'-EncodedCommand','([A-Za-z0-9+/=]+)'/.exec(script)![1];
  assert.equal(Buffer.from(b64, "base64").toString("utf16le"), cmd);
  assert.match(script, /^try \{ \$p = Start-Process powershell -Verb RunAs -Wait -PassThru /);
  assert.match(script, /catch \{ exit 1223 \}$/);
  assert.ok(!script.includes("Y웹"), "no quoting of the command itself");
  const seen: { cmd: string; args: string[]; timeout?: number }[] = [];
  assert.equal(await runElevated(cmd, async (c, args, timeout) => { seen.push({ cmd: c, args, timeout }); return { code: 1223, stdout: "" }; }), 1223);
  assert.deepEqual([seen[0].cmd, seen[0].args.slice(0, 2), seen[0].timeout! >= 600_000], ["powershell", ["-NoProfile", "-Command"], true]);
});
