import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { validateRiskSubmission } from "../server/risk-review.js";
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
const criteria = {
  name: "Synthetic human criteria",
  method: "product" as const,
  likelihood: ["L1", "L2", "L3", "L4", "L5"],
  severity: ["S1", "S2", "S3", "S4"],
  rationale: "Synthetic arithmetic test, not operational standard",
  bands: [
    { min: 1, max: 5, label: "Synthetic A", criterionAcceptable: true },
    { min: 6, max: 20, label: "Synthetic B", criterionAcceptable: false },
  ],
};
const hazard = () => ({
  id: randomUUID(),
  task: "Synthetic task",
  location: "Test location",
  category: "Human text",
  accidentType: "Human text",
  scenario: "Synthetic scenario",
  harm: "Synthetic harm",
  exposedGroup: "Generic group",
  reference: "No legal claim",
  currentControls: "Human note",
  likelihood: null as number | null,
  severity: null as number | null,
  judgmentReason: "",
  plans: [] as {
    action: string;
    controlType: "미정";
    ownerNote: string;
    due: null;
    priorityNote: string;
    preconditions: string;
  }[],
});
const draft = () => ({
  title: "Synthetic assessment",
  date: "2026-10-28",
  timing: "수시" as const,
  trigger: "Synthetic change",
  workScope: "Synthetic scope",
  method: "product" as const,
  hazards: [hazard()],
});
function complete() {
  const body = draft();
  body.hazards[0].likelihood = 5;
  body.hazards[0].severity = 4;
  body.hazards[0].judgmentReason = "Synthetic basis";
  body.hazards[0].plans = [
    {
      action: "Human plan",
      controlType: "미정",
      ownerNote: "Group",
      due: null,
      priorityNote: "",
      preconditions: "",
    },
  ];
  return body;
}
test("risk submission uses explicit software completeness rules without certifying mitigation", () => {
  const b = complete();
  assert.throws(() => validateRiskSubmission(b, criteria));
  const p = b.hazards[0].plans[0];
  Object.assign(p, { controlType: "관리적", due: "2026-11-01" });
  validateRiskSubmission(b, criteria);
  p.action = "";
  assert.throws(() => validateRiskSubmission(b, criteria));
  assert.throws(() => validateRiskSubmission(b, null));
  const low = draft();
  low.hazards[0].likelihood = 1;
  low.hazards[0].severity = 1;
  low.hazards[0].judgmentReason = "Human basis";
  validateRiskSubmission(low, criteria); // no invented all-risks-mitigated rule
});
test("risk immutable document submission, different-manager review and explicit replacement authors preserve originals", async () => {
  const f = await setup();
  try {
    const other = randomUUID(),
      password = randomUUID();
    f.db
      .prepare("INSERT INTO users VALUES(?,?,?,?)")
      .run(
        other,
        "reviewer@example.test",
        "Synthetic reviewer",
        await argon2.hash(password),
      );
    f.db
      .prepare("INSERT INTO memberships VALUES(?,?,?)")
      .run(f.site, other, "manager");
    const app = await createApp(f.db, {
        origin,
        secret: "synthetic-business-only".repeat(3),
      }),
      a = request.agent(app);
    let r = await a.get("/api/session");
    r = await a
      .post("/api/login")
      .set("Origin", origin)
      .set("x-csrf-token", r.body.csrf)
      .send({ email: "reviewer@example.test", password });
    const csrf = r.body.csrf;
    const send = (path: string, body: object, key = randomUUID()) =>
      a
        .post(f.base + path)
        .set("Origin", origin)
        .set("x-csrf-token", csrf)
        .set("idempotency-key", key)
        .send(body);
    r = await f.send("post", "/risk-criteria", criteria);
    const cid = r.body.id;
    r = await f.send("post", `/risk-criteria/${cid}/confirm`, {
      version: 1,
      reason: "Synthetic",
      confirmHumanCriteria: true,
    });
    assert.equal(r.status, 200);
    const body = complete();
    Object.assign(body.hazards[0].plans[0], {
      controlType: "관리적",
      due: "2026-11-01",
    });
    r = await f.send("post", "/risk-assessments", { body, criteriaId: cid });
    assert.equal(r.status, 200);
    const id = r.body.id;
    const submitKey = randomUUID();
    r = await f.send(
      "post",
      `/risk-assessments/${id}/submit`,
      { version: 1, reason: "Document only", confirmRecordOnly: true },
      submitKey,
    );
    assert.equal(r.status, 200);
    const original = r.body.submission;
    assert.equal(r.body.status, "submitted");
    r = await f.send("put", `/risk-assessments/${id}`, {
      version: 2,
      body,
      reason: "Cannot edit fixed body",
    });
    assert.equal(r.status, 409);
    r = await f.send("post", `/risk-assessments/${id}/review`, {
      version: 2,
      decision: "accepted",
      reason: "Self",
      confirmRecordOnly: true,
    });
    assert.equal(r.status, 403);
    const result = await Promise.all([
      send(`/risk-assessments/${id}/review`, {
        version: 2,
        decision: "accepted",
        reason: "Record review A",
        confirmRecordOnly: true,
      }),
      send(`/risk-assessments/${id}/review`, {
        version: 2,
        decision: "accepted",
        reason: "Record review B",
        confirmRecordOnly: true,
      }),
    ]);
    assert.deepEqual(result.map((x) => x.status).sort(), [200, 409]);
    let accepted = result.find((x) => x.status === 200)!.body.record;
    assert.equal(accepted.status, "accepted");
    assert.deepEqual(accepted.submission, original);
    r = await f.send(
      "post",
      `/risk-assessments/${id}/submit`,
      { version: 1, reason: "Document only", confirmRecordOnly: true },
      submitKey,
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "submitted"); // authorized historical receipt is explicitly historical
    f.db
      .prepare("DELETE FROM memberships WHERE user_id=? AND site_id=?")
      .run(f.manager, f.site);
    r = await send(`/risk-assessments/${id}/revise`, {
      version: 3,
      reason: "Replacement required",
      authorId: f.manager,
    });
    assert.equal(r.status, 400);
    r = await send(`/risk-assessments/${id}/revise`, {
      version: 3,
      reason: "Current author selected",
      authorId: other,
    });
    assert.equal(r.status, 200);
    const next = r.body.nextDraft;
    accepted = r.body.record;
    assert.equal(next.author_id, other);
    assert.equal(next.parent_id, id);
    assert.equal(next.status, "draft");
    assert.equal(next.submission, null);
    assert.equal(next.decision, null);
    assert.deepEqual(next.criteria_snapshot, accepted.criteria_snapshot);
    assert.deepEqual(accepted.submission, original);
    assert.equal(accepted.successor_id, next.id);
    r = await send(`/risk-assessments/${id}/revise`, {
      version: 4,
      reason: "No duplicate",
      authorId: other,
    });
    assert.equal(r.status, 409);
    r = await send(`/risk-assessments/${next.id}/submit`, {
      version: 1,
      reason: "Fresh review needed",
      confirmRecordOnly: true,
    });
    assert.equal(r.status, 200);
    // Restore a synthetic eligible reviewer, not the old user's authorship.
    f.db
      .prepare("INSERT INTO memberships VALUES(?,?,?)")
      .run(f.site, f.manager, "manager");
    r = await f.send("post", `/risk-assessments/${next.id}/review`, {
      version: 2,
      decision: "returned",
      authorId: other,
      reason: "Needs detail",
      confirmRecordOnly: true,
    });
    assert.equal(r.status, 200);
    const child = r.body.nextDraft;
    assert.equal(child.parent_id, next.id);
    assert.equal(child.decision, null);
    assert.equal(r.body.record.status, "returned");
    assert.throws(() =>
      f.db
        .prepare("UPDATE risk_assessments SET body=? WHERE id=?")
        .run("{}", id),
    );
    assert.throws(() =>
      f.db
        .prepare("UPDATE risk_assessments SET decision=? WHERE id=?")
        .run("{}", id),
    );
    // Failure after child insertion must not leave an orphan child or changed parent.
    r = await send(`/risk-assessments/${child.id}/submit`, {
      version: 1,
      reason: "Another document",
      confirmRecordOnly: true,
    });
    assert.equal(r.status, 200);
    f.db.exec(
      "CREATE TRIGGER synthetic_risk_review_fault BEFORE INSERT ON risk_events WHEN NEW.event='document_returned' BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END;",
    );
    const before = f.db
      .prepare("SELECT COUNT(*) n FROM risk_assessments")
      .get()!.n;
    r = await f.send("post", `/risk-assessments/${child.id}/review`, {
      version: 2,
      decision: "returned",
      authorId: other,
      reason: "Rollback",
      confirmRecordOnly: true,
    });
    assert.equal(r.status, 500);
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM risk_assessments").get()!.n,
      before,
    );
    assert.equal(
      f.db
        .prepare("SELECT status FROM risk_assessments WHERE id=?")
        .get(child.id)?.status,
      "submitted",
    );
  } finally {
    f.db.close();
  }
});
test("risk review migration preserves existing drafts without inventing submission or acceptance", async () => {
  const f = await setup();
  try {
    f.db.exec(
      "DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE IF EXISTS education_catalog_use_stops; DROP TABLE IF EXISTS cost_baseline_statements; DROP TABLE IF EXISTS cost_baselines; DROP TABLE IF EXISTS ppe_return_entries; DROP TRIGGER IF EXISTS ppe_return_terminal_state; DROP TABLE IF EXISTS work_plan_review_events; DROP TABLE IF EXISTS work_plan_document_reviews; DROP TABLE IF EXISTS cost_stock_receipts; DROP TRIGGER IF EXISTS cost_stock_split_guard; DROP TRIGGER IF EXISTS cost_stock_split_undo_guard; DROP TABLE IF EXISTS minutes_followup_events; DROP TABLE IF EXISTS minutes_followups; DROP TABLE IF EXISTS minutes_snapshots; DROP TABLE IF EXISTS minutes_records; DROP TRIGGER IF EXISTS minutes_final_fixed; DROP TRIGGER IF EXISTS minutes_final_retained; DROP TABLE IF EXISTS tbm_risk_references; DROP TABLE IF EXISTS risk_reuse_sources; DROP TABLE IF EXISTS risk_publication_events; DROP TABLE IF EXISTS risk_publication_acks; DROP TABLE IF EXISTS risk_publication_targets; DROP TABLE IF EXISTS risk_publications; DROP TABLE IF EXISTS risk_opinion_events; DROP TABLE IF EXISTS risk_opinions; DROP TABLE IF EXISTS risk_residuals;DROP TABLE IF EXISTS risk_action_events;DROP TABLE IF EXISTS risk_actions;DROP TABLE risk_events;DROP TABLE risk_assessments;DROP TABLE risk_criteria;",
    );
    const { migrateRiskCore } = await import("../server/risk-schema.js");
    migrateRiskCore(f.db);
    const id = randomUUID(),
      body = JSON.stringify(draft());
    f.db
      .prepare(
        "INSERT INTO risk_assessments VALUES(?,?,?,1,?,NULL,NULL,NULL,?,?)",
      )
      .run(id, f.site, f.manager, body, "synthetic", "synthetic");
    const { migrateRiskReview } =
      await import("../server/risk-review-schema.js");
    migrateRiskReview(f.db);
    const row = f.db
      .prepare("SELECT * FROM risk_assessments WHERE id=?")
      .get(id)!;
    assert.equal(row.body, body);
    assert.equal(row.author_id, f.manager);
    assert.equal(row.status, "draft");
    assert.equal(row.submission, null);
    assert.equal(row.decision, null);
    assert.equal(f.db.prepare("PRAGMA user_version").get()?.user_version, 23);
    assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    f.db.close();
  }
});
