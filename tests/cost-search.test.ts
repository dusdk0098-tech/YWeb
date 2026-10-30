import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { costSearchQuery, readCostSearch } from "../server/cost-search.js";
function fixture() {
  const db = openDatabase(":memory:"),
    site = randomUUID(),
    foreign = randomUUID(),
    p1 = randomUUID(),
    p2 = randomUUID(),
    category = randomUUID();
  db.exec(
    "INSERT INTO users VALUES('u','u@example.test','name','hash'),('viewer','viewer@example.test','viewer','hash')",
  );
  for (const s of [site, foreign])
    db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(s, s);
  db.prepare("INSERT INTO memberships VALUES(?,'u','manager')").run(site);
  db.prepare("INSERT INTO memberships VALUES(?,'viewer','viewer')").run(site);
  for (const [id, month] of [
    [p1, "2026-10"],
    [p2, "2026-12"],
  ])
    db.prepare(
      "INSERT INTO cost_periods(id,site_id,month,categories,opening_note,status,version,created_by,created_at,updated_at) VALUES(?,?,?,?,'test','open',1,'u','now','now')",
    ).run(
      id,
      site,
      month,
      JSON.stringify([
        { id: category, label: "label", plan: "0", opening: "0" },
      ]),
    );
  const add = (
    description: string,
    period = p1,
    date = "2026-10-01",
    status = "active",
  ) => {
    const id = randomUUID();
    db.prepare(
      "INSERT INTO cost_expenses VALUES(?,?,?,?,?,?,?, ?,?,1,'u','now','now')",
    ).run(id, period, category, date, description, "0.5", "1", "0.5", status);
    return id;
  };
  return { db, site, foreign, p1, p2, category, add };
}
test("cost search validates ranges and treats SQL LIKE special characters literally without writes", () => {
  for (const q of [
    { monthFrom: "2026-12", monthTo: "2026-01" },
    { dateFrom: "2026-12-01", dateTo: "2026-01-01" },
    { dateFrom: "2026-02-30" },
    { monthTo: "2026-13" },
    { text: "x\n" },
    { text: "x".repeat(101) },
    { status: "unknown" },
    { offset: 1.5 },
    { offset: 1000001 },
    { unknown: 1 },
  ])
    assert.equal(costSearchQuery.safeParse(q).success, false);
  const f = fixture();
  for (const s of [
    "100% literal",
    "under_score",
    "slash\\value",
    "SQL ' OR 1=1 --",
    "AbC",
    "other",
  ])
    f.add(s);
  f.add("old spend new ledger", f.p2, "2026-10-01", "cancelled");
  const find = (q: object) =>
    readCostSearch(f.db, f.site, "u", costSearchQuery.parse(q));
  const before = f.db.prepare("SELECT total_changes() n").get();
  for (const [text, description] of [
    ["%", "100% literal"],
    ["_", "under_score"],
    ["\\", "slash\\value"],
    ["' OR 1=1 --", "SQL ' OR 1=1 --"],
    ["abc", "AbC"],
  ]) {
    const r = find({ text });
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].description, description);
  }
  const both = find({
    monthFrom: "2026-12",
    monthTo: "2026-12",
    dateFrom: "2026-10-01",
    dateTo: "2026-10-01",
    status: "cancelled",
  });
  assert.equal(both.items.length, 1);
  assert.equal(both.items[0].periodMonth, "2026-12");
  assert.equal(both.items[0].spendDate, "2026-10-01");
  assert.equal(
    find({ monthTo: "2026-10", status: "cancelled" }).items.length,
    0,
  );
  assert.deepEqual(f.db.prepare("SELECT total_changes() n").get(), before);
  assert.throws(
    () => readCostSearch(f.db, f.site, "viewer", costSearchQuery.parse({})),
    /관리자/,
  );
  assert.throws(
    () => readCostSearch(f.db, f.foreign, "u", costSearchQuery.parse({})),
    /관리자/,
  );
  const keys = Object.keys(find({}).items[0]);
  for (const absent of [
    "created_by",
    "password_hash",
    "actor",
    "totals",
    "opening",
    "snapshot",
  ])
    assert.ok(!keys.includes(absent));
  f.db.close();
});
test("cost search stable 51-row pagination, scoped HTTP manager gate and current revocation", async () => {
  const f = fixture(),
    ids = [];
  for (let i = 0; i < 51; i++) ids.push(f.add("tied"));
  const a = readCostSearch(f.db, f.site, "u", costSearchQuery.parse({})),
    b = readCostSearch(
      f.db,
      f.site,
      "u",
      costSearchQuery.parse({ offset: 50 }),
    );
  assert.equal(a.items.length, 50);
  assert.equal(a.hasMore, true);
  assert.equal(b.items.length, 1);
  assert.equal(b.hasMore, false);
  assert.deepEqual(
    [...a.items, ...b.items].map((r) => r.id),
    ids.sort(),
  );
  const origin = "http://127.0.0.1:3107",
    password = "synthetic-search-password";
  f.db
    .prepare("UPDATE users SET password_hash=? WHERE id='u'")
    .run(await argon2.hash(password));
  const app = await createApp(f.db, { origin, secret: "s".repeat(48) }),
    agent = request.agent(app);
  const s = await agent.get("/api/session");
  await agent
    .post("/api/login")
    .set("Origin", origin)
    .set("x-csrf-token", s.body.csrf)
    .send({ email: "u@example.test", password })
    .expect(200);
  const path = `/api/sites/${f.site}/cost-expense-search`;
  await agent.get(path + "?text=tied").expect(200);
  await agent.get(`/api/sites/${f.foreign}/cost-expense-search`).expect(403);
  await agent.get(path + "?dateFrom=bad").expect(400);
  await request(app).get(path).expect(401);
  f.db
    .prepare(
      "UPDATE memberships SET role='editor' WHERE site_id=? AND user_id='u'",
    )
    .run(f.site);
  await agent.get(path).expect(403);
  f.db.close();
});
