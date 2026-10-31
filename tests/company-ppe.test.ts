import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { movementHash, stockState, stockItem } from "../server/stock-model.js";
import { ppeIssueInput } from "../server/ppe.js";
const origin = "http://127.0.0.1:3000";
async function setup() {
  const db = openDatabase(":memory:"),
    manager = randomUUID(),
    site = randomUUID(),
    password = randomUUID();
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
    manager,
    "synthetic@example.test",
    "Synthetic",
    await argon2.hash(password),
  );
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(
    site,
    "Synthetic site",
  );
  db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(
    site,
    manager,
    "manager",
  );
  const app = await createApp(db, {
      origin,
      secret: "synthetic-business-only".repeat(3),
    }),
    agent = request.agent(app);
  let r = await agent.get("/api/session");
  r = await agent
    .post("/api/login")
    .set("Origin", origin)
    .set("x-csrf-token", r.body.csrf)
    .send({ email: "synthetic@example.test", password });
  assert.equal(r.status, 200);
  const csrf = r.body.csrf,
    base = `/api/sites/${site}`;
  const send = (
    method: "post" | "put",
    path: string,
    body: object,
    key = randomUUID(),
  ) =>
    agent[method](base + path)
      .set("Origin", origin)
      .set("x-csrf-token", csrf)
      .set("idempotency-key", key)
      .send(body);
  return { db, manager, site, agent, base, send };
}
test("PPE input requires explicit issue confirmation and rejects unsupported partial/source fields", () => {
  assert.equal(ppeIssueInput.safeParse({}).success, false);
  assert.equal(
    ppeIssueInput.safeParse({
      confirmIssue: false,
      workerId: randomUUID(),
      workerVersion: 1,
      affiliationVersion: 0,
      companyVersion: null,
      itemId: randomUUID(),
      itemVersion: 1,
      quantity: "1",
      effectiveDate: "2026-10-28",
      trade: "",
      location: "x",
      reason: "x",
    }).success,
    false,
  );
});
test("company affiliation snapshots and exact PPE issue/full-return preserve stock and business history", async () => {
  const f = await setup();
  try {
    let r = await f.send("post", "/companies", {
      name: "<script>Company</script>",
    });
    assert.equal(r.status, 200);
    const company = r.body;
    const duplicate = await f.send("post", "/companies", {
      name: company.name,
    });
    assert.equal(duplicate.status, 200);
    assert.notEqual(duplicate.body.id, company.id);
    r = await f.send("post", "/workers", {
      name: "Synthetic worker",
      affiliation: "legacy text",
      kind: "worker",
    });
    assert.equal(r.status, 200);
    const worker = r.body;
    r = await f.send("put", `/workers/${worker.id}/company`, {
      version: 0,
      workerVersion: 1,
      companyId: company.id,
      reason: "manual affiliation",
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.worker.affiliation, "legacy text");
    r = await f.send("post", "/stock-items", {
      name: "Synthetic PPE",
      unit: "개",
    });
    assert.equal(r.status, 200);
    const item = r.body;
    r = await f.send("post", `/stock-items/${item.id}/movements`, {
      version: 1,
      kind: "opening",
      quantity: "0.3",
      effectiveDate: "2026-10-28",
      reason: "synthetic opening",
    });
    assert.equal(r.status, 200);
    const key = randomUUID(),
      input = {
        confirmIssue: true,
        workerId: worker.id,
        workerVersion: 1,
        affiliationVersion: 1,
        companyVersion: 1,
        itemId: item.id,
        itemVersion: 2,
        quantity: "0.1",
        effectiveDate: "2026-10-28",
        trade: "manual trade",
        location: "test location",
        reason: "staff entry",
      };
    r = await f.send("post", "/ppe-issues", input, key);
    assert.equal(r.status, 200, r.text);
    const issue = r.body,
      path = "/ppe-issues/" + issue.id;
    assert.equal(
      (await f.send("post", "/ppe-issues", input, key)).body.id,
      issue.id,
    );
    assert.equal(
      (await f.agent.get(f.base + "/stock-items/" + item.id)).body.balance,
      "0.2",
    );
    assert.equal(
      (
        await f.send(
          "post",
          `/stock-items/${item.id}/movements/${issue.issue_movement_id}/reverse`,
          { version: 3, effectiveDate: "2026-10-28", reason: "outside PPE" },
        )
      ).status,
      409,
    );
    r = await f.send("put", `/companies/${company.id}`, {
      version: 1,
      name: "Renamed",
      active: false,
      reason: "retired",
    });
    assert.equal(r.status, 200);
    r = await f.send("put", `/workers/${worker.id}`, {
      version: 1,
      name: "Changed worker",
      affiliation: "changed free text",
      kind: "worker",
      active: false,
    });
    assert.equal(r.status, 200);
    assert.equal(
      (
        await f.send("post", path + "/return", {
          version: 1,
          itemVersion: 3,
          effectiveDate: "2026-10-28",
          reason: "partial unsupported",
          confirmFullReturn: true,
          quantity: "0.05",
        })
      ).status,
      400,
    );
    const returns = await Promise.all(
      [1, 2].map(() =>
        f.send("post", path + "/return", {
          version: 1,
          itemVersion: 3,
          effectiveDate: "2026-10-28",
          reason: "actual full return manually recorded",
          confirmFullReturn: true,
        }),
      ),
    );
    assert.deepEqual(returns.map((v) => v.status).sort(), [200, 409]);
    r = returns.find((v) => v.status === 200)!;
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.original.company.name, company.name);
    assert.equal(r.body.original.worker.name, "Synthetic worker");
    assert.equal(r.body.original_hash, issue.original_hash);
    assert.equal(
      (await f.agent.get(f.base + "/stock-items/" + item.id)).body.balance,
      "0.3",
    );
    const state = stockState(f.db, stockItem(f.db, f.site, item.id));
    assert.equal(state.originalCount, 2);
    assert.equal(state.reversed.size, 1);
    assert.equal(
      (
        await f.send("post", path + "/return", {
          version: 2,
          itemVersion: 4,
          effectiveDate: "2026-10-28",
          reason: "duplicate return",
          confirmFullReturn: true,
        })
      ).status,
      409,
    );
    const before = f.db
      .prepare("SELECT count(*) n FROM stock_movements")
      .get()?.n;
    r = await f.send("post", path + "/notes", {
      version: 2,
      reason: "A note does not alter quantity",
      correctionMovementId: null,
    });
    assert.equal(r.status, 200);
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM stock_movements").get()?.n,
      before,
    );
    r = await f.send("post", `/stock-items/${item.id}/movements`, {
      version: 4,
      kind: "adjust_out",
      quantity: "0.1",
      effectiveDate: "2026-10-28",
      reason: "separate factual correction",
    });
    assert.equal(r.status, 200);
    const adjustment = r.body.movement.id;
    r = await f.send("post", path + "/notes", {
      version: 3,
      reason: "reference separately recorded adjustment, no double movement",
      correctionMovementId: adjustment,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "returned");
    assert.equal(
      (await f.agent.get(f.base + "/stock-items/" + item.id)).body.balance,
      "0.2",
    );
    assert.equal(
      (
        await f.send("post", path + "/notes", {
          version: 4,
          reason: "duplicate reference",
          correctionMovementId: adjustment,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await f.send("post", `/stock-items/${item.id}/movements/${adjustment}/reverse`, {
          version: 5,
          effectiveDate: "2026-10-28",
          reason: "would orphan the note reference",
        })
      ).status,
      409,
    );
    const print = await f.agent.get(f.base + path + "/print");
    assert.equal(print.status, 200);
    assert.match(print.text, /&lt;script&gt;/);
    assert.match(print.text, /부분 반납은 별도3회/);
    assert.doesNotMatch(print.text, /<script>|ad-slot/);
    assert.throws(() =>
      f.db
        .prepare("UPDATE ppe_issues SET original=? WHERE id=?")
        .run("{}", issue.id),
    );
    assert.throws(() => f.db.prepare("DELETE FROM company_events").run());
    // Stock and PPE writes are one business transaction if final ledger insertion fails.
    r = await f.send("post", "/workers", {
      name: "Second synthetic",
      affiliation: "미기록",
      kind: "worker",
    });
    const other = r.body;
    f.db.exec(
      "CREATE TRIGGER test_ppe_fail BEFORE INSERT ON ppe_events BEGIN SELECT RAISE(ABORT,'synthetic business rollback'); END",
    );
    const n = f.db.prepare("SELECT count(*) n FROM stock_movements").get()?.n;
    r = await f.send("post", "/ppe-issues", {
      ...input,
      workerId: other.id,
      workerVersion: 1,
      affiliationVersion: 0,
      companyVersion: null,
      itemVersion: 5,
      quantity: "0.1",
    });
    assert.equal(r.status, 500);
    assert.equal(
      f.db.prepare("SELECT count(*) n FROM stock_movements").get()?.n,
      n,
    );
    assert.equal(
      (await f.agent.get(f.base + "/stock-items/" + item.id)).body.balance,
      "0.2",
    );
  } finally {
    f.db.close();
  }
});
test("full PPE return uses reserved inverse slot at1000 original movements, not a new ordinary movement", async () => {
  const f = await setup();
  try {
    let r = await f.send("post", "/workers", {
      name: "Synthetic",
      affiliation: "미기록",
      kind: "worker",
    });
    const worker = r.body;
    r = await f.send("post", "/stock-items", {
      name: "PPE cap fixture",
      unit: "개",
    });
    const item = r.body;
    const at = new Date().toISOString(),
      snapshot = JSON.stringify({
        id: item.id,
        siteId: f.site,
        name: item.name,
        unit: item.unit,
      });
    const insert = f.db.prepare(
      "INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    for (let sequence = 1; sequence <= 999; sequence++) {
      const row = {
        id: randomUUID(),
        item_id: item.id,
        sequence,
        kind: sequence === 1 ? ("opening" as const) : ("receipt" as const),
        quantity: "1",
        direction: 1 as const,
        effective_date: "2026-10-28",
        reason: "synthetic boundary fixture",
        reverses_id: null,
        actor_id: f.manager,
        actor_name: "Synthetic",
        recorded_at: at,
        item_snapshot: snapshot,
        balance_after: String(sequence),
      };
      insert.run(
        row.id,
        row.item_id,
        row.sequence,
        row.kind,
        row.quantity,
        row.direction,
        row.effective_date,
        row.reason,
        row.reverses_id,
        row.actor_id,
        row.actor_name,
        row.recorded_at,
        row.item_snapshot,
        row.balance_after,
        movementHash(row),
      );
    }
    f.db.prepare("UPDATE stock_items SET version=1000 WHERE id=?").run(item.id);
    r = await f.send("post", "/ppe-issues", {
      confirmIssue: true,
      workerId: worker.id,
      workerVersion: 1,
      affiliationVersion: 0,
      companyVersion: null,
      itemId: item.id,
      itemVersion: 1000,
      quantity: "1",
      effectiveDate: "2026-10-28",
      trade: "",
      location: "fixture",
      reason: "last ordinary movement",
    });
    assert.equal(r.status, 200, r.text);
    const issue = r.body;
    r = await f.send("post", "/ppe-issues/" + issue.id + "/return", {
      version: 1,
      itemVersion: 1001,
      effectiveDate: "2026-10-28",
      reason: "full return remains possible",
      confirmFullReturn: true,
    });
    assert.equal(r.status, 200, r.text);
    const state = stockState(f.db, stockItem(f.db, f.site, item.id));
    assert.equal(state.originalCount, 1000);
    assert.equal(state.rows.length, 1001);
    assert.equal(state.balance, 999000000n);
    assert.equal(
      (
        await f.send("post", `/stock-items/${item.id}/movements`, {
          version: 1002,
          kind: "receipt",
          quantity: "1",
          effectiveDate: "2026-10-28",
          reason: "ordinary cap unchanged",
        })
      ).status,
      409,
    );
  } finally {
    f.db.close();
  }
});
test("schema20 to21 company/PPE migration preserves workers and stock", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pedit-company-migrate-")),
    path = join(dir, "db.sqlite");
  let db = openDatabase(path);
  try {
    const user = randomUUID(),
      site = randomUUID(),
      worker = randomUUID(),
      item = randomUUID();
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
      user,
      "fixture@example.test",
      "Synthetic",
      "not-a-password",
    );
    db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(
      site,
      "Preserved site",
    );
    db.prepare("INSERT INTO workers VALUES(?,?,?,?,?,1,1,?,?)").run(
      worker,
      site,
      "Preserved worker",
      "Existing free text",
      "worker",
      "before",
      "before",
    );
    db.prepare("INSERT INTO stock_items VALUES(?,?,?,?,1,?,?,?)").run(
      item,
      site,
      "Preserved item",
      "개",
      user,
      "before",
      "before",
    );
    db.exec(
      "DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE IF EXISTS education_catalog_use_stops; DROP TABLE IF EXISTS cost_baseline_statements; DROP TABLE IF EXISTS cost_baselines; DROP TABLE IF EXISTS ppe_return_entries; DROP TRIGGER IF EXISTS ppe_return_terminal_state; DROP TABLE IF EXISTS work_plan_review_events; DROP TABLE IF EXISTS work_plan_document_reviews; DROP TABLE IF EXISTS cost_stock_receipts; DROP TRIGGER IF EXISTS cost_stock_split_guard; DROP TRIGGER IF EXISTS cost_stock_split_undo_guard; DROP TABLE IF EXISTS minutes_followup_events; DROP TABLE IF EXISTS minutes_followups; DROP TABLE IF EXISTS minutes_snapshots; DROP TABLE IF EXISTS minutes_records; DROP TRIGGER IF EXISTS minutes_final_fixed; DROP TRIGGER IF EXISTS minutes_final_retained; DROP TABLE IF EXISTS tbm_risk_references; DROP TABLE IF EXISTS risk_reuse_sources; DROP TABLE IF EXISTS risk_publication_events; DROP TABLE IF EXISTS risk_publication_acks; DROP TABLE IF EXISTS risk_publication_targets; DROP TABLE IF EXISTS risk_publications; DROP TABLE IF EXISTS risk_opinion_events; DROP TABLE IF EXISTS risk_opinions; DROP TABLE IF EXISTS risk_residuals;DROP TABLE IF EXISTS risk_action_events;DROP TABLE IF EXISTS risk_actions;DROP TABLE IF EXISTS risk_events;DROP TABLE IF EXISTS risk_assessments;DROP TABLE IF EXISTS risk_criteria;DROP TABLE ppe_correction_links;DROP TABLE ppe_events;DROP TABLE ppe_issues;DROP TABLE worker_company_events;DROP TABLE worker_companies;DROP TABLE company_events;DROP TABLE companies;PRAGMA user_version=20",
    );
    db.close();
    db = openDatabase(path);
    assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(
      db.prepare("SELECT name FROM workers WHERE id=?").get(worker)?.name,
      "Preserved worker",
    );
    assert.equal(
      db.prepare("SELECT unit FROM stock_items WHERE id=?").get(item)?.unit,
      "개",
    );
    db.close();
  } finally {
    try {
      db.close();
    } catch {
      /*closed*/
    }
    await rm(dir, { recursive: true, force: true });
  }
});
