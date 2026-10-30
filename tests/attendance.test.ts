import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import request from "supertest";
import argon2 from "argon2";
import { createApp } from "../server/app.js";
import { openDatabase } from "../server/db.js";
import {
  workerInput,
  attendanceCreate,
  attendanceUpdate,
} from "../server/attendance-validation.js";
import type { WorkerRow, AttendanceRow } from "../server/attendance.js";
const origin = "http://127.0.0.1:3000";
test("worker and attendance strict schemas reject sensitive/protected fields", () => {
  assert.equal(
    workerInput.safeParse({
      name: "동명이인",
      affiliation: "업체",
      kind: "worker",
    }).success,
    true,
  );
  for (const change of [
    { nationalId: "not allowed" },
    { health: "not allowed" },
    { latitude: 1 },
    { phone: "not allowed" },
    { name: " " },
    { kind: "admin" },
  ])
    assert.equal(
      workerInput.safeParse({
        name: "대상",
        affiliation: "업체",
        kind: "worker",
        ...change,
      }).success,
      false,
    );
  assert.equal(
    attendanceCreate.safeParse({ workerId: randomUUID(), date: "2026-02-30" })
      .success,
    false,
  );
  assert.equal(
    attendanceCreate.safeParse({
      workerId: randomUUID(),
      date: "2026-10-28",
      source: "self",
    }).success,
    false,
  );
  assert.equal(
    attendanceUpdate.safeParse({ version: 1, status: "cancelled", reason: " " })
      .success,
    false,
  );
});
test("migration v1 preserves records through latest schema, is repeatable, and refuses future schema", () => {
  const dir = mkdtempSync(join(tmpdir(), "pedit-migration-")),
    path = join(dir, "old.sqlite");
  let old = new DatabaseSync(path);
  try {
    // Exact phase-one persisted table shapes; no phase-two tables exist yet.
    old.exec(`CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password_hash TEXT NOT NULL);
  CREATE TABLE sites (id TEXT PRIMARY KEY,name TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE memberships (site_id TEXT NOT NULL REFERENCES sites(id),user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL CHECK(role IN ('manager','editor','viewer')),PRIMARY KEY(site_id,user_id));
  CREATE TABLE minutes (id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),body TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,author_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE sessions(sid TEXT PRIMARY KEY,data TEXT NOT NULL,expires INTEGER NOT NULL);
  CREATE TABLE idempotency(user_id TEXT NOT NULL,scope TEXT NOT NULL,key TEXT NOT NULL,request TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(user_id,scope,key));
  CREATE TABLE audit(id INTEGER PRIMARY KEY,actor_id TEXT NOT NULL,site_id TEXT NOT NULL,event TEXT NOT NULL,record_id TEXT NOT NULL,at TEXT NOT NULL);
  INSERT INTO users VALUES('u','u@example.test','테스트','hash');INSERT INTO sites VALUES('s','기존 현장',3);INSERT INTO memberships VALUES('s','u','manager');INSERT INTO minutes VALUES('m','s','{"title":"기존 회의"}',4,'u','a','b');PRAGMA user_version=1;`);
    old.close();
    let db = openDatabase(path);
    assert.equal(
      (db.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version,
      CURRENT_SCHEMA_VERSION,
    );
    assert.equal(
      (db.prepare("SELECT version FROM minutes").get() as { version: number })
        .version,
      4,
    );
    assert.equal(
      (db.prepare("SELECT name FROM sites").get() as { name: string }).name,
      "기존 현장",
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    db.close();
    db = openDatabase(path);
    assert.equal(
      (db.prepare("SELECT count(*) AS n FROM minutes").get() as { n: number })
        .n,
      1,
    );
    db.exec("PRAGMA user_version=99");
    db.close();
    assert.throws(() => openDatabase(path), /newer/);
    old = new DatabaseSync(path);
    assert.equal(
      (old.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version,
      99,
    );
  } finally {
    old.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("manual attendance isolation, duplicate races, snapshots, corrections/history/counts/print", async () => {
  const db = openDatabase(":memory:");
  const password = randomUUID();
  const hash = await argon2.hash(password);
  for (const id of ["manager", "editor", "viewer", "outside"])
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
      id,
      id + "@example.test",
      id,
      hash,
    );
  const app = await createApp(db, {
    secret: randomUUID() + randomUUID(),
    origin,
    adsEnabled: true,
  });
  async function login(id: string) {
    const client = request.agent(app);
    const s = await client.get("/api/session");
    const r = await client
      .post("/api/login")
      .set("Origin", origin)
      .set("x-csrf-token", s.body.csrf)
      .send({ email: id + "@example.test", password });
    assert.equal(r.status, 200);
    return { client, csrf: r.body.csrf as string };
  }
  const manager = await login("manager"),
    editor = await login("editor"),
    viewer = await login("viewer"),
    outside = await login("outside");
  function write(
    who: typeof manager,
    method: "post" | "put" | "delete",
    url: string,
    body: object,
    key = randomUUID(),
  ) {
    return who.client[method](url)
      .set("Origin", origin)
      .set("x-csrf-token", who.csrf)
      .set("idempotency-key", key)
      .send(body);
  }
  try {
    const site = (
      await write(manager, "post", "/api/sites", { name: "출역 현장 <script>" })
    ).body.id as string;
    const base = `/api/sites/${site}`;
    for (const role of ["editor", "viewer"])
      await write(manager, "put", base + "/members", {
        email: role + "@example.test",
        role,
      });
    const input = {
      name: "동명이인 <script>alert(1)</script>",
      affiliation: "협력 A",
      kind: "worker",
    };
    const w1 = (await write(manager, "post", base + "/workers", input))
        .body as WorkerRow,
      w2 = (await write(manager, "post", base + "/workers", input))
        .body as WorkerRow;
    assert.notEqual(w1.id, w2.id);
    assert.equal(
      (await write(editor, "post", base + "/workers", input)).status,
      403,
    );
    assert.equal(
      (await write(viewer, "post", base + "/workers", input)).status,
      403,
    );
    assert.equal((await outside.client.get(base + "/workers")).status, 403);
    const second = (
      await write(outside, "post", "/api/sites", { name: "다른 현장" })
    ).body.id as string;
    const alien = (
      await write(outside, "post", `/api/sites/${second}/workers`, input)
    ).body as WorkerRow;
    assert.equal(
      (
        await write(manager, "post", base + "/attendance", {
          workerId: alien.id,
          date: "2026-10-28",
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await write(manager, "post", base + "/attendance", {
          workerId: w1.id,
          date: "2026-10-28",
          source: "self",
        })
      ).status,
      400,
    );
    const key = randomUUID(),
      body = { workerId: w1.id, date: "2026-10-28" };
    const created = await write(
      editor,
      "post",
      base + "/attendance",
      body,
      key,
    );
    assert.equal(created.status, 200);
    const a = created.body as AttendanceRow;
    assert.equal(a.source, "manual");
    assert.equal(
      (await write(editor, "post", base + "/attendance", body, key)).body.id,
      a.id,
    );
    assert.equal(
      (await write(editor, "post", base + "/attendance", body)).status,
      409,
    );
    const race = await Promise.all([
      write(editor, "post", base + "/attendance", {
        workerId: w2.id,
        date: "2026-10-28",
      }),
      write(manager, "post", base + "/attendance", {
        workerId: w2.id,
        date: "2026-10-28",
      }),
    ]);
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
    for (const suffix of [
      "/attendance?date=2026-10-28",
      "/attendance/print?date=2026-10-28",
      `/attendance/${a.id}/history`,
    ]) {
      assert.equal((await outside.client.get(base + suffix)).status, 403);
      assert.equal((await request(app).get(base + suffix)).status, 401);
    }
    assert.equal(
      (
        await write(viewer, "put", base + "/attendance/" + a.id, {
          version: 1,
          status: "cancelled",
          reason: "not allowed",
        })
      ).status,
      403,
    );
    const renamed = await write(manager, "put", base + "/workers/" + w1.id, {
      name: "현재 이름",
      affiliation: "협력 B",
      kind: "visitor",
      active: true,
      version: 1,
    });
    assert.equal(renamed.status, 200);
    const list = await viewer.client.get(
      base +
        "/attendance?date=2026-10-28&affiliation=" +
        encodeURIComponent("협력 A"),
    );
    assert.equal(list.body.summary.present, 2);
    assert.equal(
      list.body.items.find((r: AttendanceRow) => r.id === a.id).name,
      input.name,
    );
    const corrected = await Promise.all([
      write(editor, "put", base + "/attendance/" + a.id, {
        version: 1,
        status: "cancelled",
        reason: "날짜 오류",
      }),
      write(manager, "put", base + "/attendance/" + a.id, {
        version: 1,
        status: "cancelled",
        reason: "중복 확인",
      }),
    ]);
    assert.deepEqual(corrected.map((r) => r.status).sort(), [200, 409]);
    const history = await viewer.client.get(
      base + "/attendance/" + a.id + "/history",
    );
    assert.equal(history.body.length, 2);
    assert.equal(history.body[0].status, "present");
    assert.equal(history.body[1].status, "cancelled");
    assert.ok(history.body[1].actor_id);
    assert.ok(history.body[1].at);
    const counts = await viewer.client.get(
      base + "/attendance?date=2026-10-28",
    );
    assert.deepEqual(counts.body.summary, {
      recorded: 2,
      present: 1,
      cancelled: 1,
    });
    const printed = await viewer.client.get(
      base + "/attendance/print?date=2026-10-28",
    );
    assert.equal(printed.status, 200);
    assert.ok(printed.text.includes("&lt;script&gt;"));
    assert.ok(!printed.text.includes("<script>"));
    assert.ok(!printed.text.includes("광고"));
    assert.ok(
      printed.text.includes(
        "본인 확인·전자서명·교육/TBM 이수를 증명하지 않습니다",
      ),
    );
    assert.ok(printed.text.includes("출역 1명"));
    assert.match(printed.headers["cache-control"], /no-store/);
    await write(manager, "put", base + "/workers/" + w1.id, {
      name: "현재 이름",
      affiliation: "협력 B",
      kind: "visitor",
      active: false,
      version: 2,
    });
    assert.equal(
      (
        await write(editor, "post", base + "/attendance", {
          workerId: w1.id,
          date: "2026-10-29",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await write(editor, "put", base + "/attendance/" + a.id, {
          version: 2,
          status: "present",
          reason: "복구",
        })
      ).status,
      409,
    );
    assert.equal(
      (await manager.client.get(base + "/workers?active=true")).body.items
        .length,
      1,
    );
    assert.equal(
      (
        await write(manager, "put", base + "/workers/" + w1.id, {
          name: "bad stale",
          affiliation: "A",
          kind: "worker",
          active: true,
          version: 1,
        })
      ).status,
      409,
    );
    await write(manager, "delete", base + "/members/editor", {});
    assert.equal(
      (await write(editor, "post", base + "/attendance", body, key)).status,
      403,
    );
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
});
