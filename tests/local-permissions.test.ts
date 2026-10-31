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
test("secure plan: owner-only icacls on Windows, 0700/0600 elsewhere; apply leaves no other readers", async () => {
  const { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } = await import("node:fs"), { tmpdir } = await import("node:os"), { join } = await import("node:path");
  const { securePlan, secureApply, secureTargets } = await import("../server/local-permissions.js");
  const root = mkdtempSync(join(tmpdir(), "pedit-secure-")), data = join(root, "data"), backup = join(root, "backup");
  try {
    mkdirSync(data); mkdirSync(join(backup, "set1"), { recursive: true });
    writeFileSync(join(data, "pedit.sqlite"), "synthetic"); writeFileSync(join(data, "pedit.sqlite-wal"), ""); writeFileSync(join(backup, "set1", "pedit.sqlite"), "synthetic");
    writeFileSync(join(root, ".env"), "SESSION_SECRET=synthetic");
    const targets = secureTargets(join(data, "pedit.sqlite"), join(root, ".env"), backup);
    assert.deepEqual(targets.length, 7); // data dir + 2 files, .env, backup dir + subdir + file
    const win = securePlan(targets, "win32", "PC-1\\me");
    assert.deepEqual(win[0], { path: data, command: [data, "/inheritance:r", "/grant:r", "PC-1\\me:(OI)(CI)F", "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"] });
    assert.deepEqual((win[1] as { command: string[] }).command.slice(3), ["PC-1\\me:F", "*S-1-5-18:F", "*S-1-5-32-544:F"]);
    assert.deepEqual(securePlan(targets, "linux").map((s) => (s as { mode: number }).mode.toString(8)), ["700", "600", "600", "600", "700", "700", "600"]);
    assert.deepEqual(secureApply(securePlan(targets)), []); // real run on synthetic temp files only
    assert.equal(readFileSync(join(data, "pedit.sqlite"), "utf8"), "synthetic"); // owner can still read
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
