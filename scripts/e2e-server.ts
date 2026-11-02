import { randomUUID } from "node:crypto";
import express from "express";
import argon2 from "argon2";
import { resolve } from "node:path";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import type { PublicSetupDeps } from "../server/public-setup.js";
const db = openDatabase(":memory:");
const hash = await argon2.hash("synthetic-e2e-password");
db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
  "00000000-0000-4000-8000-000000000001",
  "test@example.test",
  "테스트 작성자",
  hash,
);
db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
  "00000000-0000-4000-8000-000000000002",
  "editor@example.test",
  "합성 조치담당",
  hash,
);
// Dedicated synthetic account so password UI scenarios do not alter other fixtures.
db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
  "00000000-0000-4000-8000-000000000003",
  "password-change@example.test",
  "합성 비밀번호 시험",
  hash,
);
// 외부 접속 마법사 spec only (scripts/e2e-runner.mjs sets TEST_PUBLIC_FAKES): the test account is the operator, and the
// router, DNS, firewall and outside test are a synthetic world the spec changes through PUT /api/test/public-state.
const fakes = process.env.TEST_PUBLIC_FAKES === "true";
const world = { dns: [] as string[], fw: 0, reach: false, upnp: false };
let publicSetup: Partial<PublicSetupDeps> | undefined;
if (fakes) {
  db.prepare("INSERT INTO account_grants(user_id,operator,issuer,granted_by,granted_at) VALUES(?,1,0,NULL,?)").run("00000000-0000-4000-8000-000000000001", new Date().toISOString());
  publicSetup = {
    upnp: { externalIp: async () => null, addPortMapping: async () => (world.upnp ? { ok: true } : { ok: false, kind: "unsupported", detail: "공유기가 자동 설정(UPnP)을 지원하지 않거나 꺼져 있습니다." }) },
    fetch: (async () => new Response("ip=203.0.113.5\n")) as typeof fetch, resolve: async () => world.dns, platform: "win32",
    run: async (_cmd, args) => (args.join(" ").includes("Get-NetFirewallRule") ? { code: 0, stdout: String(world.fw) } : args.join(" ").includes("NetConnectionProfile") ? { code: 0, stdout: "Private" } : { code: 1, stdout: "", missing: true }),
    listen: async () => () => {}, issue: async () => { if (!world.reach) throw new Error("Verify error: Connection refused"); return { cert: "", key: "" }; },
    reachCooldownMs: 0,
  };
}
const app = await createApp(db, {
  secret: randomUUID() + randomUUID(),
  origin: "http://127.0.0.1:3107",
  adsEnabled: process.env.TEST_ADS === "true",
  publicSetup,
});
app.use(express.static(resolve("dist")));
app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
// The test-only route sits in front of the app (the app answers unknown /api paths with 404).
const outer = express();
if (fakes) outer.put("/api/test/public-state", express.json(), (req, res) => { Object.assign(world, req.body); res.json(world); });
outer.use(app);
outer.listen(3107, "127.0.0.1");
