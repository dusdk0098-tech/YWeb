import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import { closeReady } from "./fixtures/cost-close-ready.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, cp, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { assertRecoveryReady } from "../server/recovery-gate.js";
import {
  createBackup,
  restoreBackup,
  verifyBackup,
  hashBackupFile,
} from "../scripts/local-backup.js";
const origin = "http://127.0.0.1:3000",
  secret = "synthetic-backup-only-secret-".repeat(3);
test("synthetic quiesced backup restores private bytes and financial snapshots, invalidates sessions but rolls back password hash", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pedit-backup-")),
    source = join(dir, "source.sqlite"),
    bundle = join(dir, "bundle");
  let db = openDatabase(source);
  try {
    const user = randomUUID(),
      outsider = randomUUID(),
      site = randomUUID(),
      foreign = randomUUID(),
      oldPassword = randomUUID(),
      newPassword = randomUUID();
    for (const id of [user, outsider])
      db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
        id,
        id + "@example.test",
        id,
        await argon2.hash(oldPassword),
      );
    for (const id of [site, foreign])
      db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(
        id,
        "Synthetic " + id,
      );
    db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(
      site,
      user,
      "manager",
    );
    db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(
      foreign,
      outsider,
      "manager",
    );
    const app = await createApp(db, { origin, secret });
    async function login(application: typeof app, password: string) {
      const agent = request.agent(application);
      let r = await agent.get("/api/session");
      r = await agent
        .post("/api/login")
        .set("Origin", origin)
        .set("x-csrf-token", r.body.csrf)
        .send({ email: user + "@example.test", password });
      return { agent, response: r, csrf: r.body.csrf };
    }
    const session = await login(app, oldPassword);
    assert.equal(session.response.status, 200);
    const cookie = session.response.headers["set-cookie"];
    const post = (path: string, body: object) =>
      session.agent
        .post(path)
        .set("Origin", origin)
        .set("x-csrf-token", session.csrf)
        .set("idempotency-key", randomUUID())
        .send(body);
    const base = `/api/sites/${site}`;
    let r = await post(base + "/hazards", {
      title: "Synthetic",
      observedDate: "2026-10-28",
      location: "test",
      description: "No real data",
    });
    assert.equal(r.status, 200);
    const hazard = r.body.id;
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2]); // Header fixture, not decoded image.
    r = await session.agent
      .post(`${base}/hazards/${hazard}/attachments`)
      .set("Origin", origin)
      .set("x-csrf-token", session.csrf)
      .set("idempotency-key", randomUUID())
      .set("Content-Type", "application/octet-stream")
      .set("x-file-name", "fixture.png")
      .set("x-file-type", "image/png")
      .set("x-hazard-version", "1")
      .send(bytes);
    assert.equal(r.status, 200);
    r = await post(`${base}/hazards/${hazard}/submit`, { version: 2 });
    assert.equal(r.status, 200);
    r = await post(base + "/cost-periods", {
      month: "2026-10",
      openingNote: "Synthetic",
      categories: [{ label: "Test", plan: "10", opening: "0" }],
    });
    assert.equal(r.status, 200);
    const period = r.body.id,
      category = r.body.categories[0].id;
    r = await post(`${base}/cost-periods/${period}/expenses`, {
      version: r.body.version,
      expense: {
        categoryId: category,
        spendDate: "2026-10-28",
        description: "Synthetic half",
        quantity: "0.5",
        unitPriceWon: "1",
      },
    });
    assert.equal(r.status, 200);
    closeReady(db);
    r = await post(`${base}/cost-periods/${period}/close`, {
      version: r.body.period.version,
      reason: "Synthetic rehearsal",
    });
    assert.equal(r.status, 200);
    const closures = db.prepare("SELECT * FROM cost_closures").all(),
      attachments = db.prepare("SELECT * FROM hazard_attachments").all(),
      original = db
        .prepare("SELECT submitted_snapshot FROM hazard_reports WHERE id=?")
        .get(hazard);
    assert.equal(db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get()?.busy, 0);
    db.close();
    const manifest = await createBackup(source, bundle);
    assert.equal(manifest.counts.hazard_attachments, 1);
    assert.equal(manifest.counts.cost_closures, 1);
    const bundleHash = await hashBackupFile(join(bundle, "database.sqlite")),
      manifestText = await readFile(join(bundle, "manifest.json"), "utf8");
    db = openDatabase(source);
    const changedApp = await createApp(db, { origin, secret });
    const current = await login(changedApp, oldPassword);
    assert.equal(
      (
        await current.agent
          .post("/api/account/password")
          .set("Origin", origin)
          .set("x-csrf-token", current.csrf)
          .send({
            currentPassword: oldPassword,
            newPassword,
            confirmPassword: newPassword,
          })
      ).status,
      204,
    );
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.close();
    const changedSource = await hashBackupFile(source);
    const restored = await restoreBackup(bundle, join(dir, "restored"));
    assert.equal(restored.report.recoveryRequired, true);
    assert.ok(restored.report.sessionsInvalidated > 0);
    assert.throws(
      () => assertRecoveryReady(restored.databasePath),
      /credential recovery/,
    );
    db = openDatabase(restored.databasePath);
    assert.equal(db.prepare("SELECT count(*) n FROM sessions").get()?.n, 0);
    assert.deepEqual(db.prepare("SELECT * FROM cost_closures").all(), closures);
    assert.deepEqual(
      db.prepare("SELECT * FROM hazard_attachments").all(),
      attachments,
    );
    assert.deepEqual(
      db
        .prepare("SELECT submitted_snapshot FROM hazard_reports WHERE id=?")
        .get(hazard),
      original,
    );
    // Deliberately bypass the launcher in this isolated test to demonstrate the recovery risk.
    const sameApp = await createApp(db, { origin, secret });
    assert.equal(
      (await request(sameApp).get("/api/sites").set("Cookie", cookie)).status,
      401,
    );
    const rotated = await createApp(db, {
      origin,
      secret: randomUUID().repeat(2),
    });
    assert.equal(
      (await request(rotated).get("/api/sites").set("Cookie", cookie)).status,
      401,
    );
    const recovered = await login(rotated, oldPassword);
    assert.equal(recovered.response.status, 200);
    assert.equal((await login(rotated, newPassword)).response.status, 401);
    assert.equal(
      (await recovered.agent.get(`/api/sites/${foreign}/cost-periods`)).status,
      403,
    );
    assert.equal(
      (await recovered.agent.get(`${base}/cost-periods/${period}/output/prepare`))
        .status,
      200,
    );
    db.close();
    const launched = spawnSync(
      process.execPath,
      ["--import", "tsx", "server/index.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DB_PATH: restored.databasePath,
          SESSION_SECRET: secret,
          APP_ORIGIN: origin,
        },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    assert.notEqual(launched.status, 0);
    assert.match(launched.stderr, /credential recovery/);
    assert.deepEqual(await hashBackupFile(source), changedSource);
    assert.deepEqual(
      await hashBackupFile(join(bundle, "database.sqlite")),
      bundleHash,
    );
    assert.equal(
      await readFile(join(bundle, "manifest.json"), "utf8"),
      manifestText,
    );
  } finally {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    await rm(dir, { recursive: true, force: true });
  }
});
test("older-schema backups still verify and restore; the app migrates the restored file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pedit-backup-older-"));
  try {
    const older = join(dir, "older.sqlite");
    openDatabase(older).close();
    // Schema56 is a version fence only, so 55 with every table is a faithful older file.
    let edit = new DatabaseSync(older);
    edit.exec(`PRAGMA user_version=${CURRENT_SCHEMA_VERSION - 1}`);
    edit.close();
    const manifest = await createBackup(older, join(dir, "bundle"));
    assert.equal(manifest.schemaVersion, CURRENT_SCHEMA_VERSION - 1);
    const restored = await restoreBackup(join(dir, "bundle"), join(dir, "restored"));
    assert.equal(restored.report.schemaVersion, CURRENT_SCHEMA_VERSION - 1);
    const migrated = openDatabase(restored.databasePath);
    assert.equal(
      (migrated.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
      CURRENT_SCHEMA_VERSION,
    );
    migrated.close();
    // A table a future schema adds is simply absent from an older file's counts.
    const missing = join(dir, "missing.sqlite");
    openDatabase(missing).close();
    edit = new DatabaseSync(missing);
    edit.exec("DROP TABLE daily_monthly_records");
    edit.close();
    const partial = await createBackup(missing, join(dir, "partial"));
    assert.equal(partial.counts.daily_monthly_records, undefined);
    await verifyBackup(join(dir, "partial"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("backup rejects damaged manifests, sidecars and partial restore failures without deleting existing destinations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pedit-backup-negative-")),
    source = join(dir, "source.sqlite"),
    bundle = join(dir, "bundle");
  const db = openDatabase(source);
  db.close();
  try {
    await createBackup(source, bundle);
    const baseline = await hashBackupFile(source);
    for (const kind of [
      "missing",
      "hash",
      "corrupt",
      "schema",
      "epoch",
      "sidecar",
    ]) {
      const bad = join(dir, kind);
      await cp(bundle, bad, { recursive: true });
      const mp = join(bad, "manifest.json"),
        p = join(bad, "database.sqlite");
      const m = JSON.parse(await readFile(mp, "utf8"));
      if (kind === "missing") await rm(mp);
      if (kind === "hash") {
        m.sha256 = "0".repeat(64);
        await writeFile(mp, JSON.stringify(m));
      }
      if (kind === "corrupt") {
        await writeFile(p, "not sqlite");
        Object.assign(m, await hashBackupFile(p));
        await writeFile(mp, JSON.stringify(m));
      }
      if (kind === "schema" || kind === "epoch") {
        const edit = new DatabaseSync(p);
        if (kind === "schema") edit.exec(`PRAGMA user_version=${CURRENT_SCHEMA_VERSION + 1}`);
        else {
          edit
            .prepare("INSERT INTO users VALUES(?,?,?,?)")
            .run(
              randomUUID(),
              "synthetic@example.test",
              "Synthetic",
              "not-a-password",
            );
          edit.exec("UPDATE account_auth SET epoch=9007199254740991");
          m.counts.users = 1;
        }
        edit.close();
        Object.assign(m, await hashBackupFile(p));
        await writeFile(mp, JSON.stringify(m));
      }
      if (kind === "sidecar") await writeFile(p + "-wal", "overlay");
      const dest = join(dir, kind + "-restore");
      await assert.rejects(restoreBackup(bad, dest));
      await assert.rejects(access(dest));
    }
    const existing = join(dir, "existing");
    await writeFile(existing, "keep");
    await assert.rejects(restoreBackup(bundle, existing));
    assert.equal(await readFile(existing, "utf8"), "keep");
    await assert.rejects(restoreBackup(bundle, join(bundle, "nested")));
    await verifyBackup(bundle);
    assert.deepEqual(await hashBackupFile(source), baseline);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
