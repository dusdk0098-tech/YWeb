import { test } from "node:test";
import assert from "node:assert/strict";
import { aclReaders } from "../server/local-permissions.js";
test("icacls parsing flags read access beyond self/SYSTEM/Administrators, ignoring inherit-only", () => {
  const path = "C:\\현장 폴더\\data";
  const out = [
    `${path} PC-1\\CodexSandboxUsers:(I)(OI)(CI)(RX)`,
    "                 NT AUTHORITY\\SYSTEM:(I)(OI)(CI)(F)",
    "                 BUILTIN\\Administrators:(I)(OI)(CI)(F)",
    "                 PC-1\\user:(I)(OI)(CI)(F)",
    "                 CREATOR OWNER:(OI)(CI)(IO)(F)",
    "                 NT AUTHORITY\\Authenticated Users:(I)(M)",
    "                 BUILTIN\\Users:(I)(W)",
    "",
    "1개 파일을 처리했으며 0개 파일은 처리하지 못했습니다.",
  ].join("\r\n");
  assert.deepEqual(aclReaders(out, path, "pc-1\\USER"), ["PC-1\\CodexSandboxUsers", "NT AUTHORITY\\Authenticated Users"]);
  assert.deepEqual(aclReaders(`${path} PC-1\\user:(F)\r\n`, path, "PC-1\\user"), []);
  assert.deepEqual(aclReaders(`${path} Everyone:(RD,WD)\r\n`, path, "PC-1\\user"), ["Everyone"]);
});
test("local permission warnings reach logged-in managers only", async () => {
  const { openDatabase } = await import("../server/db.js"), { createApp } = await import("../server/app.js"),
    { default: request } = await import("supertest"), { default: argon2 } = await import("argon2"), { randomUUID } = await import("node:crypto");
  const db = openDatabase(":memory:"), site = randomUUID(), user = randomUUID(), password = randomUUID(), origin = "http://127.0.0.1:3000";
  try {
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(user, "perm@example.test", "합성", await argon2.hash(password));
    db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site, "합성 현장");
    db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site, user, "manager");
    const app = await createApp(db, { origin, secret: "synthetic-permission-secret-".repeat(2), localPermissionWarnings: ["합성 경고"] }),
      agent = request.agent(app);
    assert.equal((await agent.get("/api/local-permissions")).status, 401);
    let r = await agent.get("/api/session");
    r = await agent.post("/api/login").set("Origin", origin).set("x-csrf-token", r.body.csrf).send({ email: "perm@example.test", password });
    assert.equal(r.status, 200);
    assert.deepEqual((await agent.get("/api/local-permissions")).body, { warnings: ["합성 경고"] });
    db.prepare("UPDATE memberships SET role='editor'").run();
    assert.equal((await agent.get("/api/local-permissions")).status, 403);
  } finally {
    db.close();
  }
});
