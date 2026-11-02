import { execFile } from "node:child_process";
import { promises as dns } from "node:dns";
import http from "node:http";
import acme from "acme-client";
import { acmeIssue, findCloudflared, redirectApp, type Issue } from "./public-serve.js";
import type { CheckResult } from "./public-setup-store.js";
import type { Upnp } from "./upnp.js";
// 외부 접속 마법사의 점검 (specs/001-easy-domain-setup/research.md R3·R4·R9, contracts/external-fixtures.md §3·§4).
// Each check returns a CheckResult with one Korean sentence; nothing here throws for an ordinary "not yet".
// Everything that touches the outside world is passed in, so tests never need a router, admin rights or the internet.
export type Run = (cmd: string, args: string[]) => Promise<{ code: number; stdout: string; missing?: boolean }>;
export const runCommand: Run = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { windowsHide: true, timeout: 20_000 }, (err, stdout) => {
    const e = err as (NodeJS.ErrnoException & { code?: number | string }) | null;
    resolve({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, stdout: String(stdout), missing: e?.code === "ENOENT" });
  });
});
const at = (now: () => Date) => now().toISOString();
const result = (now: () => Date, status: CheckResult["status"], reason: string, extra: Partial<CheckResult> = {}): CheckResult => ({ status, reason, ...extra, at: at(now) });
export type Resolve = (domain: string) => Promise<string[]>;
// Both address families, at most 3 seconds (also used by the 외부 접속 설정 screen).
export const resolveHost: Resolve = (domain) => Promise.race([
  Promise.allSettled([dns.resolve4(domain), dns.resolve6(domain)]).then((rs) => rs.flatMap((r) => (r.status === "fulfilled" ? r.value : []))),
  new Promise<string[]>((ok) => setTimeout(() => ok([]), 3000)),
]);
export async function checkDns(domain: string, publicIp: string | null, o: { resolve?: Resolve; now?: () => Date } = {}): Promise<CheckResult> {
  const now = o.now ?? (() => new Date()), found = await (o.resolve ?? resolveHost)(domain);
  if (!publicIp) return result(now, "unknown", "이 PC의 공인 IP를 확인하지 못했습니다. 인터넷 연결을 확인하세요.", { current: found.join(", ") || undefined });
  if (!found.length) return result(now, "todo", "도메인 주소가 아직 조회되지 않습니다. DNS에 A 레코드를 만들었다면 전파될 때까지 몇 분 기다리세요.", { expected: publicIp });
  if (!found.includes(publicIp)) return result(now, "todo", "도메인이 이 PC의 공인 IP를 가리키지 않습니다.", { current: found.join(", "), expected: publicIp });
  return result(now, "ok", "도메인이 이 PC의 공인 IP를 가리킵니다.", { current: publicIp, expected: publicIp });
}
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
// The router's answer first (no outside request); otherwise Cloudflare's trace page, which sees only this request's IP.
export async function publicIp(o: { upnp?: Pick<Upnp, "externalIp">; fetch?: typeof fetch } = {}) {
  const fromRouter = await o.upnp?.externalIp().catch(() => null);
  if (fromRouter) return fromRouter;
  try {
    const r = await (o.fetch ?? globalThis.fetch)("https://www.cloudflare.com/cdn-cgi/trace", { signal: AbortSignal.timeout(5000) });
    const ip = /^ip=(.+)$/m.exec((await r.text()).slice(0, 4096))?.[1]?.trim();
    return ip && (IPV4.test(ip) || ip.includes(":")) ? ip : null;
  } catch { return null; }
}
export const FIREWALL_RULE = "Y웹 HTTP/HTTPS";
export async function checkFirewall(o: { run?: Run; platform?: NodeJS.Platform; now?: () => Date } = {}): Promise<CheckResult> {
  const now = o.now ?? (() => new Date());
  if ((o.platform ?? process.platform) !== "win32") return result(now, "unknown", "이 OS의 방화벽은 확인하지 않습니다. 80·443 수신을 직접 허용하세요.");
  const r = await (o.run ?? runCommand)("powershell", ["-NoProfile", "-Command", `(Get-NetFirewallRule -DisplayName '${FIREWALL_RULE}' -ErrorAction SilentlyContinue | Measure-Object).Count`]);
  if (r.code !== 0) return result(now, "unknown", "Windows 방화벽 상태를 읽지 못했습니다.");
  return Number(r.stdout.trim()) > 0
    ? result(now, "ok", "Windows 방화벽이 80·443 수신을 허용합니다.")
    : result(now, "todo", "Windows 방화벽에 80·443 허용 규칙이 없습니다.");
}
export async function checkCloudflared(o: { run?: Run; bin?: string; now?: () => Date } = {}): Promise<CheckResult> {
  const now = o.now ?? (() => new Date());
  const r = await (o.run ?? runCommand)(o.bin ?? findCloudflared(), ["--version"]);
  if (r.missing) return result(now, "todo", "cloudflared가 설치되어 있지 않습니다.");
  if (r.code !== 0) return result(now, "unknown", "cloudflared를 실행하지 못했습니다.");
  const version = r.stdout.trim().split(/\r?\n/)[0].slice(0, 120);
  return result(now, "ok", "cloudflared가 설치되어 있습니다.", { current: version });
}
// "Public" networks make Windows drop the router's SSDP replies, so UPnP looks absent even when the router has it.
export async function networkProfile(o: { run?: Run; platform?: NodeJS.Platform } = {}) {
  if ((o.platform ?? process.platform) !== "win32") return null;
  const r = await (o.run ?? runCommand)("powershell", ["-NoProfile", "-Command", "(Get-NetConnectionProfile | Select-Object -First 1).NetworkCategory"]);
  return r.code === 0 ? r.stdout.trim() || null : null;
}
export const PUBLIC_PROFILE_NOTE = "이 PC의 네트워크가 '공용'으로 설정되어 있어 공유기 자동 설정이 막힐 수 있습니다.";
// 외부 도달 시험: a real validation by the Let's Encrypt *staging* CA (its own account key; the certificate is thrown away).
// It proves DNS and port 80 from outside in one step. A temporary listener answers the challenge while the app is not yet
// serving port 80. Failed validations are rate-limited, so a result is reused for 30 seconds.
export type Listen = (handler: http.RequestListener, port: number) => Promise<() => void>;
const listenHttp: Listen = (handler, port) => new Promise((ok, fail) => {
  const s = http.createServer(handler);
  s.once("error", fail).listen(port, "0.0.0.0", () => ok(() => s.close()));
});
export const stagingIssue: Issue = acmeIssue(acme.directory.letsencrypt.staging, "staging-account.key");
export const REACH_COOLDOWN_MS = 30_000;
const lastReach = new Map<string, { result: CheckResult; t: number }>();
export function reachReason(message: string): { status: CheckResult["status"]; reason: string } {
  if (/rateLimited|too many/i.test(message)) return { status: "unknown", reason: "시험 횟수 제한에 걸렸습니다. 잠시 뒤 다시 확인하세요." };
  if (/DNS problem|NXDOMAIN|no valid A|SERVFAIL/i.test(message)) return { status: "todo", reason: "Let's Encrypt가 이 도메인의 주소를 찾지 못했습니다. DNS 전파 전일 수 있습니다." };
  if (/Connection refused/i.test(message)) return { status: "todo", reason: "밖에서 80 포트로 접속이 거부됐습니다. 공유기 포트포워딩을 확인하세요." };
  if (/Timeout|timed out|firewall/i.test(message)) return { status: "todo", reason: "밖에서 80 포트에 닿지 않습니다. 공유기 포트포워딩과 Windows 방화벽을 확인하세요." };
  return { status: "todo", reason: "외부 도달 시험에 실패했습니다: " + message.split("\n")[0].slice(0, 200) };
}
export async function reachabilityTest(o: { domain: string; dir: string; port?: number; issue?: Issue; listen?: Listen; now?: () => Date; cooldownMs?: number }): Promise<CheckResult> {
  const now = o.now ?? (() => new Date()), t = now().getTime(), cached = lastReach.get(o.domain);
  if (cached && t - cached.t < (o.cooldownMs ?? REACH_COOLDOWN_MS)) return cached.result;
  const challenges = new Map<string, string>();
  let close: (() => void) | undefined, r: CheckResult;
  try {
    close = await (o.listen ?? listenHttp)(redirectApp(o.domain, challenges, 443), o.port ?? 80);
    await (o.issue ?? stagingIssue)(o.domain, "", o.dir, challenges);
    r = result(now, "ok", "밖에서 80 포트로 이 PC에 닿습니다.");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    r = err.code === "EADDRINUSE" ? result(now, "unknown", "80 포트를 다른 프로그램이 쓰고 있습니다(IIS·Skype 등). 그 프로그램을 끄고 다시 확인하세요.")
      : err.code === "EACCES" ? result(now, "unknown", "80 포트를 열 권한이 없습니다.")
        : (() => { const m = reachReason(err.message ?? String(e)); return result(now, m.status, m.reason); })();
  } finally { close?.(); }
  lastReach.set(o.domain, { result: r, t });
  return r;
}
export const resetReachCache = () => lastReach.clear();
// 적용 확인: after the app starts serving its domain, open it once from this PC. For a direct connection a failure is
// "확인 불가" (many routers do not let a LAN PC reach its own public address); a tunnel always goes through Cloudflare.
export async function selfCheck(origin: string, mode: "direct" | "tunnel", o: { fetch?: typeof fetch; now?: () => Date } = {}) {
  const at = (o.now ?? (() => new Date()))().toISOString();
  try {
    const r = await (o.fetch ?? globalThis.fetch)(origin + "/api/session", { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    if (r.ok) return { at, ok: true, detail: `${origin} 에 접속됩니다.` };
    throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    return mode === "direct"
      ? { at, ok: null, detail: "이 PC에서 자기 도메인으로 접속하지 못했습니다. 공유기가 내부 접속을 막는 경우가 많으니 휴대폰(LTE)으로 확인하세요." }
      : { at, ok: false, detail: `${origin} 에 접속하지 못했습니다(${(e as Error).message}). 터널 상태를 확인하세요.` };
  }
}
