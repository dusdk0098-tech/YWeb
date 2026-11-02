import dgram from "node:dgram";
import os from "node:os";
// 공유기 자동 설정 (UPnP IGD, specs/001-easy-domain-setup/research.md R1, contracts/external-fixtures.md §2).
// No dependency: SSDP M-SEARCH → device description → SOAP, following miniupnpc. Many routers have UPnP off, so every
// failure is a normal result the wizard turns into manual port-forwarding steps (R9), never an exception.
export const SEARCH_TARGETS = [
  "urn:schemas-upnp-org:device:InternetGatewayDevice:1",
  "urn:schemas-upnp-org:service:WANIPConnection:1",
  "urn:schemas-upnp-org:service:WANPPPConnection:1",
  "upnp:rootdevice",
];
export type Discover = (targets: string[], timeoutMs: number) => Promise<string[]>;
export type Gateway = { controlUrl: string; serviceType: string; host: string };
export type UpnpFailure = { ok: false; kind: "unsupported" | "conflict" | "rejected"; code?: number; detail: string };
export type UpnpResult = { ok: true } | UpnpFailure;
const MAX_BODY = 64 * 1024;
export const searchMessage = (st: string, timeoutMs: number) =>
  Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nST: ${st}\r\nMAN: "ssdp:discover"\r\nMX: ${Math.max(1, Math.floor(timeoutMs / 1000))}\r\n\r\n`);
export const ssdpDiscover: Discover = (targets, timeoutMs) => new Promise((resolve) => {
  const s = dgram.createSocket({ type: "udp4", reuseAddr: true }), found = new Set<string>();
  let done = false;
  const finish = () => { if (done) return; done = true; try { s.close(); } catch { /* already closed */ } resolve([...found]); };
  s.on("message", (m) => { const loc = /^location:[ \t]*(.+)$/im.exec(m.toString()); if (loc) found.add(loc[1].trim()); });
  s.on("error", finish);
  s.bind(0, () => { for (const st of targets) s.send(searchMessage(st, timeoutMs), 1900, "239.255.255.250"); });
  setTimeout(finish, timeoutMs + 500);
});
// A spoofed SSDP reply could point anywhere; only follow plain http to a private LAN address.
export function lanUrl(u: string) {
  try {
    const url = new URL(u), [a, b] = url.hostname.split(".").map(Number);
    const isPrivate = /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) && (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
    return url.protocol === "http:" && isPrivate ? url : null;
  } catch { return null; }
}
export function parseDescription(xml: string, location: string): Gateway | null {
  const services = [...xml.matchAll(/<service>([\s\S]*?)<\/service>/g)].map((m) => ({
    type: /<serviceType>\s*([^<\s]+)\s*<\/serviceType>/.exec(m[1])?.[1] ?? "",
    control: /<controlURL>\s*([^<\s]+)\s*<\/controlURL>/.exec(m[1])?.[1] ?? "",
  }));
  const pick = services.find((s) => /:WANIPConnection:\d$/.test(s.type) && s.control) ?? services.find((s) => /:WANPPPConnection:\d$/.test(s.type) && s.control);
  if (!pick) return null;
  const base = /<URLBase>\s*([^<\s]+)\s*<\/URLBase>/.exec(xml)?.[1] ?? location;
  const control = lanUrl(new URL(pick.control, base).toString());
  return control ? { controlUrl: control.toString(), serviceType: pick.type, host: control.hostname } : null;
}
const esc = (v: string) => v.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
// This PC's LAN address on the gateway's subnet (a VPN or virtual adapter must not win).
export function localAddressFor(gatewayHost: string, nics = os.networkInterfaces()) {
  const all = Object.values(nics).flat().filter((n): n is os.NetworkInterfaceInfo => !!n && n.family === "IPv4" && !n.internal).map((n) => n.address);
  const prefix = gatewayHost.split(".").slice(0, 3).join(".") + ".";
  return all.find((a) => a.startsWith(prefix)) ?? all.find((a) => lanUrl(`http://${a}/`)) ?? null;
}
const CONFLICT = new Set([606, 718, 729]);
export function createUpnp(o: { discover?: Discover; fetch?: typeof fetch; timeoutMs?: number; nics?: NodeJS.Dict<os.NetworkInterfaceInfo[]> } = {}) {
  const discover = o.discover ?? ssdpDiscover, doFetch = o.fetch ?? globalThis.fetch, timeoutMs = o.timeoutMs ?? 2000;
  let cached: Gateway | null = null;
  async function text(r: Response) { return (await r.text()).slice(0, MAX_BODY); }
  async function gateway(): Promise<Gateway | null> {
    if (cached) return cached;
    for (const loc of await discover(SEARCH_TARGETS, timeoutMs)) {
      if (!lanUrl(loc)) continue;
      try {
        const r = await doFetch(loc, { signal: AbortSignal.timeout(3000) });
        const g = r.ok ? parseDescription(await text(r), loc) : null;
        if (g) return (cached = g);
      } catch { /* try the next reply */ }
    }
    return null;
  }
  async function soap(g: Gateway, action: string, args: [string, string][]) {
    const body = `<?xml version="1.0"?>\r\n<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>`
      + `<u:${action} xmlns:u="${g.serviceType}">${args.map(([k, v]) => `<${k}>${esc(v)}</${k}>`).join("")}</u:${action}></s:Body></s:Envelope>`;
    const r = await doFetch(g.controlUrl, {
      method: "POST", body, signal: AbortSignal.timeout(5000),
      headers: { "content-type": 'text/xml; charset="utf-8"', soapaction: `"${g.serviceType}#${action}"` },
    });
    const t = await text(r);
    return { ok: r.ok, text: t, code: Number(/<errorCode>\s*(\d+)\s*<\/errorCode>/.exec(t)?.[1]) || undefined };
  }
  const none: UpnpFailure = { ok: false, kind: "unsupported", detail: "공유기가 자동 설정(UPnP)을 지원하지 않거나 꺼져 있습니다." };
  return {
    gateway,
    async externalIp(): Promise<string | null> {
      const g = await gateway();
      if (!g) return null;
      try {
        const r = await soap(g, "GetExternalIPAddress", []);
        const ip = r.ok ? /<NewExternalIPAddress>\s*([\d.]+)\s*</.exec(r.text)?.[1] : undefined;
        return ip && !lanUrl(`http://${ip}/`) ? ip : null; // a private "external" IP means another router sits in front
      } catch { return null; }
    },
    async addPortMapping(m: { externalPort: number; internalPort: number; description?: string }): Promise<UpnpResult> {
      const g = await gateway();
      if (!g) return none;
      const client = localAddressFor(g.host, o.nics);
      if (!client) return { ...none, detail: "이 PC의 내부 IP를 찾지 못했습니다." };
      try {
        const r = await soap(g, "AddPortMapping", [
          ["NewRemoteHost", ""], ["NewExternalPort", String(m.externalPort)], ["NewProtocol", "TCP"], ["NewInternalPort", String(m.internalPort)],
          ["NewInternalClient", client], ["NewEnabled", "1"], ["NewPortMappingDescription", m.description ?? "YWeb"], ["NewLeaseDuration", "0"],
        ]);
        if (r.ok) return { ok: true };
        return CONFLICT.has(r.code ?? 0)
          ? { ok: false, kind: "conflict", code: r.code, detail: "공유기가 다른 설정과 겹쳐 자동으로 열 수 없습니다." }
          : { ok: false, kind: "rejected", code: r.code, detail: "공유기가 자동 설정 요청을 거부했습니다." };
      } catch { return { ...none, detail: "공유기가 자동 설정 요청에 응답하지 않습니다." }; }
    },
  };
}
export type Upnp = ReturnType<typeof createUpnp>;
