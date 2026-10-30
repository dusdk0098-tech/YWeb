import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import {
  compareEnteredDate,
  equipmentDueBody,
} from "../server/equipment-due.js";
test("manual equipment due dates use explicit calendar reference, not certification", () => {
  assert.equal(compareEnteredDate(null, "2026-10-28"), "not_recorded");
  assert.equal(
    compareEnteredDate("2026-10-27", "2026-10-28"),
    "before_reference",
  );
  assert.equal(compareEnteredDate("2026-10-28", "2026-10-28"), "on_reference");
  assert.equal(
    compareEnteredDate("2026-10-29", "2026-10-28"),
    "after_reference",
  );
  assert.equal(
    equipmentDueBody.safeParse({
      nextInspectionDate: "2025-02-29",
      insuranceRecordedUntil: null,
      sourceNote: "",
    }).success,
    false,
  );
  assert.equal(
    equipmentDueBody.safeParse({
      nextInspectionDate: "",
      insuranceRecordedUntil: null,
      sourceNote: "",
    }).success,
    false,
  );
  assert.equal(
    equipmentDueBody.safeParse({
      nextInspectionDate: null,
      insuranceRecordedUntil: null,
      sourceNote: "",
      certified: true,
    }).success,
    false,
  );
});
test("due metadata manager history, reader comparison and frozen use snapshot", async () => {
  const db = openDatabase(":memory:"),
    site = randomUUID(),
    origin = "http://127.0.0.1:3000",
    password = randomUUID(),
    hash = await argon2.hash(password),
    ids = { manager: randomUUID(), editor: randomUUID(), viewer: randomUUID() };
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site, "synthetic");
  for (const [role, id] of Object.entries(ids)) {
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
      id,
      role + "@example.test",
      role,
      hash,
    );
    db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site, id, role);
  }
  const app = await createApp(db, { origin, secret: "d".repeat(48) });
  async function login(role: string) {
    const agent = request.agent(app);
    let r = await agent.get("/api/session");
    r = await agent
      .post("/api/login")
      .set("Origin", origin)
      .set("x-csrf-token", r.body.csrf)
      .send({ email: role + "@example.test", password });
    return { agent, csrf: r.body.csrf as string };
  }
  const m = await login("manager"),
    v = await login("viewer"),
    e = await login("editor");
  const root = `/api/sites/${site}`;
  const post = (path: string, body: object) =>
    m.agent
      .post(root + path)
      .set("Origin", origin)
      .set("x-csrf-token", m.csrf)
      .set("idempotency-key", randomUUID())
      .send(body);
  const put = (body: object, key = randomUUID()) =>
    m.agent
      .put(root + `/equipment/${item.id}/due-metadata`)
      .set("Origin", origin)
      .set("x-csrf-token", m.csrf)
      .set("idempotency-key", key)
      .send(body);
  let r = await post("/equipment", {
    assetCode: "",
    name: "machine",
    typeLabel: "manual",
    model: "",
    serial: "",
    ownerCompany: "",
    notes: "",
  });
  assert.equal(r.status, 200, r.text);
  let item = r.body;
  const old = await post("/equipment-uses", {
    equipmentId: item.id,
    body: { date: "2026-10-28", location: "site", workSummary: "manual" },
  });
  assert.equal(old.status, 200);
  assert.equal(old.body.equipment_snapshot.dueMetadata, null);
  const key = randomUUID(),
    payload = {
      version: item.version,
      reason: "entered from manual note",
      body: {
        nextInspectionDate: "2026-10-28",
        insuranceRecordedUntil: "2026-10-27",
        sourceNote: "<script>not verified",
      },
    };
  r = await put(payload, key);
  assert.equal(r.status, 200, r.text);
  item = r.body;
  assert.equal((await put(payload, key)).body.version, item.version);
  assert.equal(
    (
      await e.agent
        .put(root + `/equipment/${item.id}/due-metadata`)
        .set("Origin", origin)
        .set("x-csrf-token", e.csrf)
        .set("idempotency-key", randomUUID())
        .send({ ...payload, version: item.version })
    ).status,
    403,
  );
  assert.equal((await v.agent.get(root + "/equipment-due")).status, 400);
  const viewed = await v.agent.get(root + "/equipment-due?asOfDate=2026-10-28");
  assert.equal(viewed.status, 200);
  assert.equal(viewed.body.items[0].inspection, "on_reference");
  assert.equal(viewed.body.items[0].insurance, "before_reference");
  const use = await post("/equipment-uses", {
    equipmentId: item.id,
    body: {
      date: "2026-10-28",
      location: "site",
      workSummary: "manual current",
    },
  });
  assert.equal(use.status, 200);
  assert.equal(
    use.body.equipment_snapshot.dueMetadata.nextInspectionDate,
    "2026-10-28",
  );
  r = await put({
    version: item.version,
    reason: "clear uncertain dates",
    body: {
      nextInspectionDate: null,
      insuranceRecordedUntil: null,
      sourceNote: "",
    },
  });
  assert.equal(r.status, 200);
  item = r.body;
  assert.equal(
    (await v.agent.get(root + `/equipment-uses/${use.body.id}`)).body
      .equipment_snapshot.dueMetadata.sourceNote,
    "<script>not verified",
  );
  const historic = await v.agent.get(root + `/equipment/${item.id}/events`);
  assert.equal(
    historic.body.items[1].snapshot.dueMetadata.nextInspectionDate,
    "2026-10-28",
  );
  const oldprint = await v.agent.get(
    root + `/equipment-uses/${old.body.id}/print`,
  );
  assert.equal(oldprint.status, 200);
  assert.ok(oldprint.text.includes("미기록"));
  const fixed = await v.agent.get(
    root + `/equipment-uses/${use.body.id}/print`,
  );
  assert.ok(fixed.text.includes("&lt;script&gt;not verified"));
  assert.ok(!fixed.text.includes("<script>"));
  db.prepare(
    "UPDATE memberships SET role='editor' WHERE site_id=? AND user_id=?",
  ).run(site, ids.manager);
  assert.equal((await put(payload, key)).status, 403);
  db.close();
});
