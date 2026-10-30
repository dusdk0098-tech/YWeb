import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase, type Db } from "../server/db.js";
import { createApp } from "../server/app.js";
import { costSplitInput, splitChildren } from "../server/cost-split-model.js";
import { getExpense, getCostPeriod } from "../server/cost-model.js";
function fixture(path = ":memory:") {
  const db = openDatabase(path),
    site = randomUUID(),
    period = randomUUID(),
    category = randomUUID(),
    source = randomUUID();
  db.exec("INSERT INTO users VALUES('u','u@example.test','synthetic','hash')");
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(
    site,
    "source <script>",
  );
  db.prepare("INSERT INTO memberships VALUES(?,'u','manager')").run(site);
  db.prepare(
    "INSERT INTO cost_periods(id,site_id,month,categories,opening_note,status,version,created_by,created_at,updated_at) VALUES(?,?,'2026-10',?,'test','open',1,'u','now','now')",
  ).run(
    period,
    site,
    JSON.stringify([{ id: category, label: "one", plan: "0", opening: "0" }]),
  );
  db.prepare(
    "INSERT INTO cost_expenses VALUES(?,?,?,?,?,?,?,?,'active',1,'u','now','now')",
  ).run(
    source,
    period,
    category,
    "2026-10-01",
    "parent <script>",
    "1",
    "2",
    "2",
  );
  return { db, site, period, category, source };
}
const kids = [
  { description: "first", quantity: "0.5", unitPriceWon: "1" },
  { description: "second", quantity: "0.5", unitPriceWon: "3" },
];
async function client(db: Db) {
  const password = "synthetic-split-password",
    origin = "http://127.0.0.1:3107";
  db.prepare("UPDATE users SET password_hash=? WHERE id='u'").run(
    await argon2.hash(password),
  );
  const app = await createApp(db, { origin, secret: "s".repeat(48) }),
    agent = request.agent(app);
  let s = await agent.get("/api/session");
  s = await agent
    .post("/api/login")
    .set("Origin", origin)
    .set("x-csrf-token", s.body.csrf)
    .send({ email: "u@example.test", password })
    .expect(200);
  return {
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
test("cost split requires BOTH exact numeric quantity and amount with strict inherited category/date", () => {
  const f = fixture(),
    source = getExpense(f.db, f.period, f.source),
    input = { version: 1, reason: "allocation", children: kids };
  assert.equal(splitChildren(source, costSplitInput.parse(input)).length, 2);
  for (const bad of [
    [
      { description: "a", quantity: "1", unitPriceWon: "1" },
      { description: "b", quantity: "1", unitPriceWon: "1" },
    ],
    [
      { description: "a", quantity: "0.5", unitPriceWon: "1" },
      { description: "b", quantity: "0.5", unitPriceWon: "1" },
    ],
  ])
    assert.throws(
      () =>
        splitChildren(
          source,
          costSplitInput.parse({ ...input, children: bad }),
        ),
      /각각 원행/,
    );
  assert.equal(
    costSplitInput.safeParse({
      ...input,
      children: kids.map((c) => ({ ...c, categoryId: f.category })),
    }).success,
    false,
  );
  assert.equal(
    costSplitInput.safeParse({ ...input, children: [kids[0]] }).success,
    false,
  );
  assert.equal(
    costSplitInput.safeParse({ ...input, children: Array(21).fill(kids[0]) })
      .success,
    false,
  );
  for (let n = 2; n <= 100; n++) {
    const parent = {
      ...source,
      quantity: String(n),
      unit_price_won: "3",
      amount: String(n * 3),
    };
    const result = splitChildren(
      parent,
      costSplitInput.parse({
        ...input,
        children: [
          { description: "a", quantity: "1", unitPriceWon: "3" },
          { description: "b", quantity: String(n - 1), unitPriceWon: "3" },
        ],
      }),
    );
    assert.equal(
      result.reduce((sum, r) => sum + BigInt(r.amount), 0n),
      BigInt(n) * 3n,
    );
  }
  f.db.close();
});
test("cost split immutable provenance, zero-row undo, failed undo atomic rollback and repeat source policy", async () => {
  const f = fixture(),
    c = await client(f.db),
    base = `/api/sites/${f.site}/cost-periods/${f.period}`,
    key = randomUUID(),
    input = { version: 1, reason: "split", children: kids };
  const s = (
    await c
      .post(base + "/expenses/" + f.source + "/split", input, key)
      .expect(200)
  ).body;
  assert.equal(s.period.version, 4);
  assert.equal(s.period.totals.total.current, "2");
  assert.equal(s.snapshot.children.length, 2);
  assert.equal(s.eligibility.allowed, true);
  assert.deepEqual(
    (
      await c
        .post(base + "/expenses/" + f.source + "/split", input, key)
        .expect(200)
    ).body,
    s,
  );
  await c
    .post(base + "/expenses/" + f.source + "/restore", {
      version: 4,
      reason: "direct",
    })
    .expect(409);
  await c
    .post(base + "/expenses/" + s.snapshot.children[0].id + "/split", {
      ...input,
      version: 4,
    })
    .expect(409);
  assert.throws(() =>
    f.db.prepare("UPDATE cost_splits SET body='{}' WHERE id=?").run(s.id),
  );
  assert.throws(() =>
    f.db
      .prepare("UPDATE cost_expenses SET description='x' WHERE id=?")
      .run(f.source),
  );
  const count = () =>
    (
      f.db.prepare("SELECT count(*) n FROM cost_expenses").get() as {
        n: number;
      }
    ).n;
  const before = count();
  f.db.exec(
    "CREATE TRIGGER test_undo_failure BEFORE INSERT ON cost_events WHEN NEW.event='expense_split_undo_source' BEGIN SELECT RAISE(ABORT,'synthetic undo failure'); END;",
  );
  await c
    .post(base + "/splits/" + s.id + "/undo", { version: 4, reason: "undo" })
    .expect(500);
  assert.equal(getCostPeriod(f.db, f.site, f.period).version, 4);
  assert.equal(getExpense(f.db, f.period, f.source).status, "cancelled");
  assert.equal(
    (
      f.db.prepare("SELECT status FROM cost_splits WHERE id=?").get(s.id) as {
        status: string;
      }
    ).status,
    "active",
  );
  f.db.exec("DROP TRIGGER test_undo_failure");
  const u = (
    await c
      .post(base + "/splits/" + s.id + "/undo", { version: 4, reason: "undo" })
      .expect(200)
  ).body;
  assert.equal(u.period.version, 7);
  assert.equal(u.period.totals.total.current, "2");
  assert.equal(count(), before);
  assert.equal(u.status, "undone");
  assert.equal(getExpense(f.db, f.period, f.source).status, "active");
  await c
    .post(base + "/expenses/" + s.snapshot.children[0].id + "/restore", {
      version: 7,
      reason: "old child",
    })
    .expect(409);
  const again = (
    await c
      .post(base + "/expenses/" + f.source + "/split", { ...input, version: 7 })
      .expect(200)
  ).body;
  assert.notEqual(again.id, s.id);
  assert.equal(
    (await c.agent.get(base + "/splits").expect(200)).body.items.length,
    2,
  );
  assert.equal(
    (await c.agent.get(base + "/splits/" + s.id).expect(200)).body.status,
    "undone",
  );
  const html = (
    await c.agent.get(base + "/splits/" + s.id + "/print").expect(200)
  ).text;
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  f.db.prepare("UPDATE memberships SET role='viewer' WHERE user_id='u'").run();
  await c
    .post(base + "/expenses/" + f.source + "/split", input, key)
    .expect(403);
  await c.agent.get(base + "/splits/" + s.id + "/print").expect(403);
  f.db.close();
});
test("cost split exact1000 retained still permits undo and schema18 migration preserves originals", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pedit-split-")),
    path = join(dir, "test.sqlite");
  try {
    const f = fixture(path);
    const insert = f.db.prepare(
      "INSERT INTO cost_expenses VALUES(?,?,?,?,?,?,?,?,'cancelled',1,'u','now','now')",
    );
    for (let i = 0; i < 997; i++)
      insert.run(
        randomUUID(),
        f.period,
        f.category,
        "2026-10-01",
        "retained",
        "1",
        "1",
        "1",
      );
    const c = await client(f.db),
      base = `/api/sites/${f.site}/cost-periods/${f.period}`;
    const s = (
      await c
        .post(base + "/expenses/" + f.source + "/split", {
          version: 1,
          reason: "cap",
          children: kids,
        })
        .expect(200)
    ).body;
    assert.equal(
      (
        f.db.prepare("SELECT count(*) n FROM cost_expenses").get() as {
          n: number;
        }
      ).n,
      1000,
    );
    const u = (
      await c
        .post(base + "/splits/" + s.id + "/undo", {
          version: 4,
          reason: "undo at cap",
        })
        .expect(200)
    ).body;
    assert.equal(u.period.totals.total.current, "2");
    assert.equal(
      (
        f.db.prepare("SELECT count(*) n FROM cost_expenses").get() as {
          n: number;
        }
      ).n,
      1000,
    );
    await c
      .post(base + "/expenses/" + f.source + "/split", {
        version: 7,
        reason: "no room",
        children: kids,
      })
      .expect(409);
    f.db.close();
    const reopened = openDatabase(path);
    assert.equal(
      (
        reopened.prepare("SELECT count(*) n FROM cost_splits").get() as {
          n: number;
        }
      ).n,
      1,
    );
    reopened.close();
    const oldPath = join(dir, "old.sqlite"),
      old = fixture(oldPath);
    old.db.exec(
      "DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE IF EXISTS education_catalog_use_stops; DROP TABLE IF EXISTS cost_baseline_statements; DROP TABLE IF EXISTS cost_baselines; DROP TABLE IF EXISTS ppe_return_entries; DROP TRIGGER IF EXISTS ppe_return_terminal_state; DROP TABLE IF EXISTS work_plan_review_events; DROP TABLE IF EXISTS work_plan_document_reviews; DROP TABLE IF EXISTS cost_stock_receipts; DROP TRIGGER IF EXISTS cost_stock_split_guard; DROP TRIGGER IF EXISTS cost_stock_split_undo_guard; DROP TABLE IF EXISTS minutes_followup_events; DROP TABLE IF EXISTS minutes_followups; DROP TABLE IF EXISTS minutes_snapshots; DROP TABLE IF EXISTS minutes_records; DROP TRIGGER IF EXISTS minutes_final_fixed; DROP TRIGGER IF EXISTS minutes_final_retained; DROP TABLE IF EXISTS tbm_risk_references; DROP TABLE IF EXISTS risk_reuse_sources; DROP TABLE IF EXISTS risk_publication_events; DROP TABLE IF EXISTS risk_publication_acks; DROP TABLE IF EXISTS risk_publication_targets; DROP TABLE IF EXISTS risk_publications; DROP TABLE IF EXISTS risk_opinion_events; DROP TABLE IF EXISTS risk_opinions; DROP TABLE IF EXISTS risk_residuals;DROP TABLE IF EXISTS risk_action_events;DROP TABLE IF EXISTS risk_actions;DROP TABLE IF EXISTS risk_events;DROP TABLE IF EXISTS risk_assessments;DROP TABLE IF EXISTS risk_criteria;DROP TABLE IF EXISTS ppe_correction_links;DROP TABLE IF EXISTS ppe_events;DROP TABLE IF EXISTS ppe_issues;DROP TABLE IF EXISTS worker_company_events;DROP TABLE IF EXISTS worker_companies;DROP TABLE IF EXISTS company_events;DROP TABLE IF EXISTS companies;DROP TABLE IF EXISTS work_stop_events; DROP TABLE IF EXISTS work_stops; DROP TRIGGER cost_split_active_source_frozen;DROP TRIGGER cost_split_undone_child_restore;DROP TABLE cost_split_children;DROP TABLE cost_splits;PRAGMA user_version=18",
    );
    old.db.close();
    const upgraded = openDatabase(oldPath);
    assert.equal(getExpense(upgraded, old.period, old.source).amount, "2");
    assert.equal(
      (
        upgraded.prepare("PRAGMA user_version").get() as {
          user_version: number;
        }
      ).user_version,
      CURRENT_SCHEMA_VERSION,
    );
    upgraded.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
