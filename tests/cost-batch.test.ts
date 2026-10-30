import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import argon2 from "argon2";
import { openDatabase, type Db } from "../server/db.js";
import { createApp } from "../server/app.js";
import {
  costTsvHeader,
  costBatchInput,
  previewCostBatch,
} from "../server/cost-batch.js";
import { getCostPeriod } from "../server/cost-model.js";
function fixture() {
  const db = openDatabase(":memory:"),
    site = randomUUID(),
    period = randomUUID(),
    category = randomUUID();
  db.exec("INSERT INTO users VALUES('u','u@example.test','user','hash')");
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site, "site");
  db.prepare(
    "INSERT INTO cost_periods(id,site_id,month,categories,opening_note,status,version,created_by,created_at,updated_at) VALUES(?,?,'2026-10',?,'synthetic','open',1,'u','now','now')",
  ).run(
    period,
    site,
    JSON.stringify([
      { id: category, label: "manual", plan: "10", opening: "0" },
    ]),
  );
  return { db, site, period, category };
}
function row(
  category: string,
  description = "literal",
  quantity = "0.5",
  price = "1",
) {
  return [category, "2026-10-01", description, quantity, price].join("\t");
}
function preview(f: ReturnType<typeof fixture>, text: string) {
  return previewCostBatch(
    f.db,
    getCostPeriod(f.db, f.site, f.period),
    costBatchInput.parse({ version: 1, tsv: text }),
  );
}
test("cost TSV strict grammar byte/row bounds, exact decimals and business-read-only preview", () => {
  const f = fixture(),
    before = f.db.prepare("SELECT total_changes() n").get();
  const text =
    costTsvHeader +
    "\n" +
    row(f.category, "=1+1") +
    "\n" +
    row(f.category, "other", "0.5");
  const a = preview(f, text),
    b = preview(f, text.replaceAll("\n", "\r\n"));
  assert.equal(a.digest, b.digest);
  assert.equal(a.batchAmount, "1");
  assert.equal(a.projected?.total.current, "1");
  assert.equal(a.rows[0].expense.description, "=1+1");
  assert.deepEqual(f.db.prepare("SELECT total_changes() n").get(), before);
  for (const invalid of [
    "\uFEFF" + text,
    text + "\n\n",
    text.replace("\tquantity", "\tqty"),
    text.replace("=1+1", "=1\t+1"),
    text.replace("0.5", "1e2"),
    text.replace("0.5", "0.0000001"),
    text.replace("2026-10-01", "2026-02-30"),
    text.replace("2026-10-01", "2026-11-01"),
    text.replace("=1+1", "x\ry"),
  ])
    assert.equal(preview(f, invalid).digest, null, invalid);
  assert.equal(preview(f, text + "\n").errors.length, 0);
  assert.equal(
    preview(
      f,
      costTsvHeader + "\n" + Array(100).fill(row(f.category)).join("\n"),
    ).rows.length,
    100,
  );
  assert.equal(
    preview(
      f,
      costTsvHeader + "\n" + Array(101).fill(row(f.category)).join("\n"),
    ).digest,
    null,
  );
  assert.equal(
    costBatchInput.safeParse({ version: 1, tsv: "한".repeat(40000) }).success,
    false,
  );
  assert.equal(
    preview(f, costTsvHeader + "\n" + row(f.category, "bad", "1", "0")).digest,
    null,
  );
  assert.equal(
    preview(
      f,
      costTsvHeader +
        "\n" +
        row(f.category, "bad", "1000000000", "1000000000000"),
    ).digest,
    null,
  );
  f.db.close();
});
async function client(db: Db) {
  const origin = "http://127.0.0.1:3107",
    password = "synthetic-batch-password";
  db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(
    await argon2.hash(password),
    "u",
  );
  const app = await createApp(db, { origin, secret: "b".repeat(48) }),
    agent = request.agent(app);
  let s = await agent.get("/api/session");
  s = await agent
    .post("/api/login")
    .set("Origin", origin)
    .set("x-csrf-token", s.body.csrf)
    .send({ email: "u@example.test", password });
  return {
    app,
    agent,
    post: (path: string, body: object, key = randomUUID()) =>
      agent
        .post(path)
        .set("Origin", origin)
        .set("x-csrf-token", s.body.csrf)
        .set("idempotency-key", key)
        .send(body),
  };
}
test("cost TSV atomic batch, digest scope, duplicate acknowledgement, replay, rollback and manager gate", async () => {
  const f = fixture();
  f.db
    .prepare("INSERT INTO memberships VALUES(?,?,?)")
    .run(f.site, "u", "manager");
  const c = await client(f.db),
    base = `/api/sites/${f.site}/cost-periods/${f.period}/expense-batch`,
    tsv = costTsvHeader + "\n" + row(f.category) + "\n" + row(f.category);
  const p = (await c.post(base + "/preview", { version: 1, tsv }).expect(200))
    .body;
  assert.equal(p.hasDuplicates, true);
  assert.deepEqual(p.rows[0].duplicateLines, [3]);
  const value = {
    version: 1,
    tsv,
    previewDigest: p.digest,
    acknowledgeDuplicates: false,
  };
  await c.post(base + "/commit", value).expect(400);
  await c
    .post(base + "/commit", {
      ...value,
      previewDigest: "0".repeat(64),
      acknowledgeDuplicates: true,
    })
    .expect(409);
  const baseline = () => ({
    expenses: f.db.prepare("SELECT count(*) n FROM cost_expenses").get(),
    events: f.db.prepare("SELECT count(*) n FROM cost_events").get(),
    audit: f.db.prepare("SELECT count(*) n FROM audit").get(),
    version: getCostPeriod(f.db, f.site, f.period).version,
  });
  const before = baseline();
  f.db.exec(
    "CREATE TRIGGER test_batch_failure BEFORE INSERT ON cost_events WHEN (SELECT count(*) FROM cost_expenses)>1 BEGIN SELECT RAISE(ABORT,'synthetic batch failure'); END;",
  );
  await c
    .post(base + "/commit", { ...value, acknowledgeDuplicates: true })
    .expect(500);
  assert.deepEqual(baseline(), before);
  f.db.exec("DROP TRIGGER test_batch_failure");
  const key = randomUUID(),
    input = { ...value, acknowledgeDuplicates: true },
    saved = (await c.post(base + "/commit", input, key).expect(200)).body;
  assert.equal(saved.count, 2);
  assert.equal(saved.batchAmount, "1");
  assert.equal(saved.period.totals.total.current, "1");
  assert.equal(saved.period.version, 3);
  assert.deepEqual(
    (await c.post(base + "/commit", input, key).expect(200)).body,
    saved,
  );
  assert.equal(
    (
      f.db.prepare("SELECT count(*) n FROM cost_expenses").get() as {
        n: number;
      }
    ).n,
    2,
  );
  await c.post(base + "/commit", input).expect(409);
  const next = (
    await c
      .post(base + "/preview", {
        version: 3,
        tsv: costTsvHeader + "\n" + row(f.category),
      })
      .expect(200)
  ).body;
  assert.equal(next.rows[0].existingActive, 2);
  assert.equal(next.hasDuplicates, true);
  f.db
    .prepare(
      "UPDATE memberships SET role='editor' WHERE site_id=? AND user_id='u'",
    )
    .run(f.site);
  await c.post(base + "/commit", input, key).expect(403);
  await c.post(base + "/preview", { version: 3, tsv }).expect(403);
  f.db.close();
});
test("cost TSV 1000 retained boundary includes cancelled rows and aggregate overflow blocks preview", async () => {
  const f = fixture();
  f.db
    .prepare("INSERT INTO memberships VALUES(?,?,?)")
    .run(f.site, "u", "manager");
  const insert = f.db.prepare(
    "INSERT INTO cost_expenses VALUES(?,?,?,?,?,?,?,?,'cancelled',1,'u','now','now')",
  );
  for (let i = 0; i < 999; i++)
    insert.run(
      randomUUID(),
      f.period,
      f.category,
      "2026-10-01",
      "old",
      "1",
      "1",
      "1",
    );
  const two = preview(
    f,
    costTsvHeader + "\n" + row(f.category) + "\n" + row(f.category),
  );
  assert.equal(two.digest, null);
  assert.ok(two.errors.some((e) => e.message.includes("1,000")));
  const tsv = costTsvHeader + "\n" + row(f.category),
    p = preview(f, tsv);
  assert.ok(p.digest);
  const c = await client(f.db),
    base = `/api/sites/${f.site}/cost-periods/${f.period}/expense-batch`;
  const r = (
    await c
      .post(base + "/commit", {
        version: 1,
        tsv,
        previewDigest: p.digest,
        acknowledgeDuplicates: false,
      })
      .expect(200)
  ).body;
  assert.equal(r.period.totals.cancelledCount, 999);
  assert.equal(r.period.totals.activeCount, 1);
  const over = (
    await c.post(base + "/preview", { version: 2, tsv }).expect(200)
  ).body;
  assert.equal(over.digest, null);
  f.db.close();
  const g = fixture();
  g.db.prepare("UPDATE cost_periods SET categories=? WHERE id=?").run(
    JSON.stringify([
      {
        id: g.category,
        label: "cap",
        plan: "0",
        opening: "1000000000000000",
      },
    ]),
    g.period,
  );
  const bad = preview(
    g,
    costTsvHeader + "\n" + row(g.category, "overflow", "0.000001"),
  );
  assert.equal(bad.digest, null);
  assert.equal(bad.projected, null);
  g.db.close();
});
