import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createUpnp, lanUrl, localAddressFor, parseDescription, searchMessage, SEARCH_TARGETS } from "../server/upnp.js";
// 공유기 자동 설정 (specs/001-easy-domain-setup research R1): fixed replies from tests/fixtures/upnp-fixtures.json, no network.
const fx = JSON.parse(readFileSync("tests/fixtures/upnp-fixtures.json", "utf8")) as Record<string, string>;
const nics = { eth: [{ address: "192.168.0.23", family: "IPv4", internal: false, netmask: "255.255.255.0", mac: "", cidr: null }], vpn: [{ address: "10.8.0.2", family: "IPv4", internal: false, netmask: "255.255.255.0", mac: "", cidr: null }] } as never;
function router(soapReply: (action: string, body: string) => { status: number; body: string }) {
  const calls: { action: string; body: string }[] = [];
  const fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u === fx.location) return new Response(fx.description);
    if (u === "http://192.168.0.1:1900/ctl/IPConn") {
      const action = /#(\w+)"$/.exec(String((init?.headers as Record<string, string>).soapaction))![1], body = String(init?.body);
      calls.push({ action, body });
      const r = soapReply(action, body);
      return new Response(r.body, { status: r.status });
    }
    throw new Error("unexpected " + u);
  }) as typeof globalThis.fetch;
  return { calls, upnp: createUpnp({ discover: async () => [fx.location], fetch, nics }) };
}
test("upnp: search message, LAN-only locations, description parsing", () => {
  assert.equal(searchMessage(SEARCH_TARGETS[1], 2000).toString(), 'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nST: urn:schemas-upnp-org:service:WANIPConnection:1\r\nMAN: "ssdp:discover"\r\nMX: 2\r\n\r\n');
  for (const bad of ["https://192.168.0.1/x", "http://203.0.113.9/x", "http://router.local/x", "file:///c:/x"]) assert.equal(lanUrl(bad), null, bad);
  for (const ok of ["http://192.168.0.1:1900/a", "http://10.0.0.1/a", "http://172.16.5.1/a"]) assert.ok(lanUrl(ok), ok);
  assert.deepEqual(parseDescription(fx.description, fx.location), { controlUrl: "http://192.168.0.1:1900/ctl/IPConn", serviceType: "urn:schemas-upnp-org:service:WANIPConnection:1", host: "192.168.0.1" });
  const ppp = fx.description.replace("WANIPConnection:1", "WANPPPConnection:1");
  assert.equal(parseDescription(ppp, fx.location)?.serviceType, "urn:schemas-upnp-org:service:WANPPPConnection:1");
  assert.equal(parseDescription(fx.description.replace("/ctl/IPConn", "http://203.0.113.9/ctl"), fx.location), null); // control URL off the LAN
  assert.equal(parseDescription("<root/>", fx.location), null);
  assert.equal(localAddressFor("192.168.0.1", nics), "192.168.0.23"); // the gateway's subnet, not the VPN
});
test("upnp: external IP and two port mappings in the argument order routers expect", async () => {
  const { calls, upnp } = router((action) => ({ status: 200, body: action === "GetExternalIPAddress" ? fx.externalIp : fx.addOk }));
  assert.equal(await upnp.externalIp(), "203.0.113.5");
  assert.deepEqual(await upnp.addPortMapping({ externalPort: 80, internalPort: 80 }), { ok: true });
  assert.deepEqual(await upnp.addPortMapping({ externalPort: 443, internalPort: 443 }), { ok: true });
  const add = calls.filter((c) => c.action === "AddPortMapping");
  assert.equal(add.length, 2);
  const names = [...add[0].body.matchAll(/<(New\w+)>/g)].map((m) => m[1]);
  assert.deepEqual(names, ["NewRemoteHost", "NewExternalPort", "NewProtocol", "NewInternalPort", "NewInternalClient", "NewEnabled", "NewPortMappingDescription", "NewLeaseDuration"]);
  assert.match(add[0].body, /<NewInternalClient>192\.168\.0\.23<\/NewInternalClient>/);
  assert.match(add[1].body, /<NewExternalPort>443<\/NewExternalPort>/);
});
test("upnp: faults, private external IPs and silent routers become ordinary results", async () => {
  assert.equal((await router(() => ({ status: 500, body: fx.fault718 })).upnp.addPortMapping({ externalPort: 80, internalPort: 80 }) as { kind: string }).kind, "conflict");
  for (const [code, kind] of [[606, "conflict"], [729, "conflict"], [402, "rejected"], [501, "rejected"], [716, "rejected"]] as const) {
    const r = await router(() => ({ status: 500, body: fx.fault718.replace("718", String(code)) })).upnp.addPortMapping({ externalPort: 80, internalPort: 80 });
    assert.deepEqual([r.ok, (r as { kind: string }).kind, (r as { code: number }).code], [false, kind, code]);
  }
  const doubleNat = router(() => ({ status: 200, body: fx.externalIp.replace("203.0.113.5", "192.168.1.2") }));
  assert.equal(await doubleNat.upnp.externalIp(), null);
  const silent = createUpnp({ discover: async () => [], fetch: (async () => { throw new Error("no"); }) as never });
  assert.equal(await silent.externalIp(), null);
  assert.deepEqual(await silent.addPortMapping({ externalPort: 80, internalPort: 80 }), { ok: false, kind: "unsupported", detail: "공유기가 자동 설정(UPnP)을 지원하지 않거나 꺼져 있습니다." });
  const spoofed = createUpnp({ discover: async () => ["http://203.0.113.66/evil.xml"], fetch: (async () => { throw new Error("must not fetch"); }) as never });
  assert.equal((await spoofed.addPortMapping({ externalPort: 80, internalPort: 80 }) as { kind: string }).kind, "unsupported");
});
