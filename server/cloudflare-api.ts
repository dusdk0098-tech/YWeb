// Cloudflare API v4 for the wizard (specs/001-easy-domain-setup/research.md R2, contracts/external-fixtures.md §1).
// Only the calls the wizard needs. Every create is preceded by a lookup, so running it twice changes nothing; an existing
// DNS record with another value is reported as a conflict and only replaced when the user says so. The token never
// appears in errors.
const BASE = "https://api.cloudflare.com/client/v4", MAX_BODY = 64 * 1024;
export class CloudflareError extends Error {}
type Envelope<T> = { success: boolean; errors?: { code: number; message: string }[]; result: T };
type Zone = { id: string; name: string; account: { id: string } };
type Tunnel = { id: string; name: string; deleted_at?: string | null };
type DnsRecord = { id: string; type: string; name: string; content: string; proxied?: boolean };
export type DnsWanted = { type: "A" | "CNAME"; name: string; content: string; proxied: boolean };
export type DnsOutcome = { status: "created" | "reused" | "replaced" } | { status: "conflict"; current: string };
// What the user picks on the Cloudflare "Create API token" screen (shown with a copy button).
export const CF_TOKEN_PERMISSIONS = ["Account › Cloudflare Tunnel › Edit", "Zone › DNS › Edit", "Zone › Zone › Read"];
export function createCloudflare(token: string, doFetch: typeof fetch = globalThis.fetch) {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let r: Response;
    try {
      r = await doFetch(BASE + path, {
        method, signal: AbortSignal.timeout(10_000), body: body === undefined ? undefined : JSON.stringify(body),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      });
    } catch (e) { throw new CloudflareError("Cloudflare에 연결하지 못했습니다: " + (e as Error).message); }
    const text = await r.text();
    if (text.length > MAX_BODY) throw new CloudflareError("Cloudflare 응답이 너무 큽니다.");
    let j: Envelope<T>;
    try { j = JSON.parse(text) as Envelope<T>; } catch { throw new CloudflareError(`Cloudflare 응답을 읽지 못했습니다(HTTP ${r.status}).`); }
    if (!r.ok || !j.success) throw new CloudflareError("Cloudflare 응답: " + (j.errors?.[0]?.message ?? `HTTP ${r.status}`));
    return j.result;
  }
  const q = encodeURIComponent;
  return {
    async verify() {
      const r = await call<{ status: string }>("GET", "/user/tokens/verify");
      if (r.status !== "active") throw new CloudflareError(`토큰 상태가 '${r.status}'입니다. 새 토큰을 만드세요.`);
    },
    // safety.example.co.kr → tries co.kr, example.co.kr, … and returns the first zone this token can see.
    async findZone(host: string) {
      const labels = host.split(".");
      for (let n = 2; n <= labels.length; n++) {
        const name = labels.slice(-n).join(".");
        const z = (await call<Zone[]>("GET", `/zones?name=${q(name)}&status=active`)).find((v) => v.name === name);
        if (z) return { zoneId: z.id, accountId: z.account.id, zone: z.name };
      }
      return null;
    },
    async ensureTunnel(accountId: string, name: string) {
      // The list filter is not documented as exact, so compare again here.
      const found = (await call<Tunnel[]>("GET", `/accounts/${q(accountId)}/cfd_tunnel?is_deleted=false&name=${q(name)}`)).find((t) => t.name === name && !t.deleted_at);
      if (found) return { id: found.id, created: false };
      const t = await call<Tunnel>("POST", `/accounts/${q(accountId)}/cfd_tunnel`, { name, config_src: "cloudflare" });
      return { id: t.id, created: true };
    },
    putIngress: (accountId: string, tunnelId: string, host: string, port: number) =>
      call<unknown>("PUT", `/accounts/${q(accountId)}/cfd_tunnel/${q(tunnelId)}/configurations`, {
        config: { ingress: [{ hostname: host, service: `http://127.0.0.1:${port}` }, { service: "http_status:404" }] },
      }),
    tunnelToken: (accountId: string, tunnelId: string) => call<string>("GET", `/accounts/${q(accountId)}/cfd_tunnel/${q(tunnelId)}/token`),
    async ensureDns(zoneId: string, want: DnsWanted, overwrite = false): Promise<DnsOutcome> {
      const existing = await call<DnsRecord[]>("GET", `/zones/${q(zoneId)}/dns_records?name=${q(want.name)}`);
      const same = existing.find((r) => r.type === want.type && r.content === want.content && !!r.proxied === want.proxied);
      if (same && existing.length === 1) return { status: "reused" };
      if (existing.length && !overwrite) return { status: "conflict", current: existing.map((r) => `${r.type} ${r.content}${r.proxied ? " (프록시)" : ""}`).join(", ") };
      // A/AAAA and CNAME cannot share a name, so replacing means removing what is there first.
      for (const r of existing) await call<unknown>("DELETE", `/zones/${q(zoneId)}/dns_records/${q(r.id)}`);
      await call<DnsRecord>("POST", `/zones/${q(zoneId)}/dns_records`, { ...want, ttl: 1 });
      return { status: existing.length ? "replaced" : "created" };
    },
  };
}
export type Cloudflare = ReturnType<typeof createCloudflare>;
