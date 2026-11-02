import type { Db } from "./db.js";
import { readPublicSettings, type PublicRuntime } from "./public-access.js";
import { publicIp } from "./public-checks.js";
import { readSetup } from "./public-setup-store.js";
import type { PublicSetupDeps } from "./public-setup.js";
// 외부 접속 감시 (specs/001-easy-domain-setup US3): every 10 minutes while a direct connection runs, keep the router
// mappings and the DNS record pointing at this PC. With the wizard's Cloudflare token for this domain the A record is
// fixed here; otherwise the home screen says what changed. A tunnel needs neither (cloudflared reports its own state).
export type Monitor = { db: Db; secret: string; runtime: PublicRuntime; deps: PublicSetupDeps };
export async function monitorTick({ db, secret, runtime, deps }: Monitor) {
  if (runtime.mode !== "direct" || runtime.state !== "실행 중") return;
  // Routers forget UPnP mappings on reboot; adding the same mapping again is harmless, and a router without UPnP stays silent.
  for (const port of [80, 443]) await deps.upnp.addPortMapping({ externalPort: port, internalPort: port }).catch(() => undefined);
  const ip = await publicIp({ upnp: deps.upnp, fetch: deps.fetch });
  if (!ip) return; // offline: keep the last state
  const domain = readPublicSettings(db, secret).domain;
  if ((await deps.resolve(domain)).includes(ip)) { runtime.dnsMismatch = undefined; return; }
  const s = readSetup(db, secret);
  if (s?.cfToken && s.cfZoneId && s.domain === domain) {
    try {
      await deps.cloudflare(s.cfToken).ensureDns(s.cfZoneId, { type: "A", name: domain, content: ip, proxied: false }, true);
      runtime.dnsMismatch = undefined;
      return;
    } catch { /* report below */ }
  }
  runtime.dnsMismatch = `도메인이 이 PC의 새 공인 IP(${ip})를 가리키지 않습니다. DNS의 A 레코드를 고치세요.`;
}
export function startMonitor(m: Monitor, intervalMs = 600_000) {
  const timer = setInterval(() => void monitorTick(m).catch(() => undefined), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
// One line for the operator's home screen; step = the wizard step that fixes it.
export function summarize(runtime: PublicRuntime, wizardStarted: boolean): { tone: "ok" | "warn" | "error" | "off"; step: string | null; line: string } {
  if (runtime.mode === "off") return { tone: "off", step: null, line: wizardStarted ? "도메인 연결을 마저 진행하세요." : "휴대폰에서도 쓰려면 도메인을 연결하세요." };
  if (runtime.state === "중지") return { tone: "error", step: runtime.mode === "tunnel" ? "cloudflared" : "router", line: `외부 접속이 멈췄습니다: ${runtime.detail ?? ""}`.trim() };
  if (runtime.mode === "tunnel" && runtime.state !== "실행 중") return { tone: "warn", step: "cloudflared", line: `외부 접속 연결 중: ${runtime.detail ?? runtime.state}` };
  if (runtime.dnsMismatch) return { tone: "error", step: "dns", line: runtime.dnsMismatch };
  if (runtime.state !== "실행 중") return { tone: "warn", step: null, line: `외부 접속 ${runtime.state}` };
  return { tone: "ok", step: null, line: `외부 접속 정상 · ${runtime.origin}${runtime.certNotAfter ? ` · 인증서 ${runtime.certNotAfter.slice(0, 10)}까지` : ""}` };
}
