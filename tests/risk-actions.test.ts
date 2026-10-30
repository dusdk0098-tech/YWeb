import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";

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
async function acceptedSource() {
  const f = await setup(),
    reviewer = randomUUID(),
    password = randomUUID();
  f.db
    .prepare("INSERT INTO users VALUES(?,?,?,?)")
    .run(
      reviewer,
      "action-reviewer@example.test",
      "Synthetic reviewer",
      await argon2.hash(password),
    );
  f.db
    .prepare("INSERT INTO memberships VALUES(?,?,?)")
    .run(f.site, reviewer, "manager");
  const app = await createApp(f.db, {
      origin,
      secret: "synthetic-business-only".repeat(3),
    }),
    agent = request.agent(app);
  let r = await agent.get("/api/session");
  r = await agent
    .post("/api/login")
    .set("Origin", origin)
    .set("x-csrf-token", r.body.csrf)
    .send({ email: "action-reviewer@example.test", password });
  const csrf = r.body.csrf,
    send = (path: string, body: object, key = randomUUID()) =>
      agent
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
  body.hazards[0].plans.push({
    ...body.hazards[0].plans[0],
    action: "Second human plan",
  });
  r = await f.send("post", "/risk-assessments", { body, criteriaId: cid });
  const id = r.body.id;
  r = await f.send("post", `/risk-assessments/${id}/submit`, {
    version: 1,
    reason: "Document only",
    confirmRecordOnly: true,
  });
  assert.equal(r.status, 200);
  r = await send(`/risk-assessments/${id}/review`, {
    version: 2,
    decision: "accepted",
    reason: "Record review",
    confirmRecordOnly: true,
  });
  assert.equal(r.status, 200);
  return { ...f, reviewer, reviewSend: send, doc: r.body.record, body };
}
test("risk plan tracking preserves source, manual report and different-person confirmation with non-lossy correction", async () => {
  const f = await acceptedSource();
  try {
    const create = {
      version: 3,
      hazardId: f.body.hazards[0].id,
      planIndex: 0,
      assigneeId: f.manager,
      due: "2026-11-02",
      reason: "Explicit tracking",
      confirmManualTracking: true,
    };
    const races = await Promise.all([
      f.reviewSend(`/risk-assessments/${f.doc.id}/actions`, create),
      f.reviewSend(`/risk-assessments/${f.doc.id}/actions`, create),
    ]);
    assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
    let row = races.find((r) => r.status === 200)!.body;
    const id = row.id,
      original = row.source;
    assert.equal(row.status, "assigned");
    assert.equal(row.report, null);
    assert.equal(row.source.hazard.plans[0].due, "2026-11-01");
    assert.equal(row.due, "2026-11-02");
    let r = await f.send("post", `/risk-actions/${id}/report`, {
      version: 1,
      text: "Human states work done",
      claimedLocalDate: "2026-10-31",
      reason: "Factual report",
      confirmHumanReport: true,
    });
    assert.equal(r.status, 200);
    row = r.body;
    assert.equal(row.report.actor.id, f.manager);
    assert.equal(row.report.claimedLocalDate, "2026-10-31");
    assert.match(row.report.recordedAt, /Z$/);
    r = await f.send("post", `/risk-actions/${id}/verify`, {
      version: 2,
      decision: "confirm",
      note: "Self",
      claimedLocalDate: "2026-11-01",
      reason: "Self",
      confirmHumanVerification: true,
    });
    assert.equal(r.status, 403);
    r = await f.reviewSend(`/risk-actions/${id}/verify`, {
      version: 2,
      decision: "confirm",
      note: "Early date",
      claimedLocalDate: "2026-10-30",
      reason: "Invalid chronology",
      confirmHumanVerification: true,
    });
    assert.equal(r.status, 400);
    r = await f.send("post", `/risk-actions/${id}/report`, {
      version: 2,
      text: "Corrected human report",
      claimedLocalDate: "2026-11-01",
      reason: "Reasoned correction",
      confirmHumanReport: true,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.version, 3);
    r = await f.reviewSend(`/risk-actions/${id}/verify`, {
      version: 3,
      decision: "reject",
      note: "Need more detail",
      claimedLocalDate: "2026-11-01",
      reason: "Human review",
      confirmHumanVerification: true,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "assigned");
    assert.equal(r.body.report, null);
    r = await f.send("post", `/risk-actions/${id}/report`, {
      version: 4,
      text: "More detail",
      claimedLocalDate: "2026-11-01",
      reason: "Re-report",
      confirmHumanReport: true,
    });
    assert.equal(r.status, 200);
    r = await f.reviewSend(`/risk-actions/${id}/verify`, {
      version: 5,
      decision: "confirm",
      note: "Named person records confirmation",
      claimedLocalDate: "2026-11-02",
      reason: "Human review only",
      confirmHumanVerification: true,
    });
    assert.equal(r.status, 200);
    row = r.body;
    assert.equal(row.status, "verified");
    assert.equal(row.verification.actor.id, f.reviewer);
    assert.deepEqual(row.source, original);
    r = await f.send("post", `/risk-actions/${id}/report`, {
      version: 6,
      text: "Cannot overwrite confirmed",
      claimedLocalDate: "2026-11-01",
      reason: "Correction requires reopen",
      confirmHumanReport: true,
    });
    assert.equal(r.status, 409);
    r = await f.reviewSend(`/risk-actions/${id}/assign`, {
      version: 6,
      assigneeId: f.reviewer,
      due: "2026-11-03",
      reason: "Need reopen",
    });
    assert.equal(r.status, 409);
    r = await f.reviewSend(`/risk-actions/${id}/reopen`, {
      version: 6,
      reason: "New information",
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "assigned");
    assert.equal(r.body.verification, null);
    r = await f.reviewSend(`/risk-actions/${id}/assign`, {
      version: 7,
      assigneeId: f.reviewer,
      due: "2026-11-03",
      reason: "Explicit new responsibility",
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.assignee_id, f.reviewer);
    r = await f.agent.get(f.base + `/risk-actions/${id}/events`);
    assert.equal(r.status, 200);
    assert.equal(r.body.items.length, 8);
    assert.equal(
      JSON.parse(r.body.items[5].snapshot).verification.actor.id,
      f.reviewer,
    );
    assert.equal(
      JSON.parse(r.body.items[1].snapshot).report.text,
      "Human states work done",
    );
    r = await f.reviewSend(`/risk-assessments/${f.doc.id}/revise`, {
      version: 3,
      reason: "Source correction",
      authorId: f.reviewer,
    });
    assert.equal(r.status, 200);
    const next = r.body.nextDraft.id;
    r = await f.agent.get(f.base + `/risk-actions/${id}`);
    assert.equal(r.body.sourceDocument.successorId, next);
    assert.equal(r.body.sourceDocument.successorStatus, "draft");
    assert.deepEqual(r.body.source, original);
    assert.equal(r.body.status, "assigned");
    r = await f.reviewSend(`/risk-assessments/${f.doc.id}/actions`, {
      ...create,
      version: 4,
      planIndex: 1,
    });
    assert.equal(r.status, 409);
    assert.throws(() =>
      f.db.prepare("UPDATE risk_actions SET source=? WHERE id=?").run("{}", id),
    );
    assert.throws(() =>
      f.db.prepare("DELETE FROM risk_action_events WHERE action_id=?").run(id),
    );
  } finally {
    f.db.close();
  }
});
test("risk action event failure rolls back link and row, repeat key returns one and invalid date is rejected", async () => {
  const f = await acceptedSource();
  try {
    const input = {
      version: 3,
      hazardId: f.body.hazards[0].id,
      planIndex: 0,
      assigneeId: f.manager,
      due: "2026-11-02",
      reason: "Explicit tracking",
      confirmManualTracking: true,
    };
    let r = await f.reviewSend(`/risk-assessments/${f.doc.id}/actions`, {
      ...input,
      due: "2026-02-30",
    });
    assert.equal(r.status, 400);
    f.db.exec(
      "CREATE TRIGGER synthetic_action_failure BEFORE INSERT ON risk_action_events BEGIN SELECT RAISE(ABORT,'synthetic business rollback'); END;",
    );
    r = await f.reviewSend(`/risk-assessments/${f.doc.id}/actions`, input);
    assert.equal(r.status, 500);
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM risk_actions").get()?.n,
      0,
    );
    f.db.exec("DROP TRIGGER synthetic_action_failure");
    const key = randomUUID();
    r = await f.reviewSend(`/risk-assessments/${f.doc.id}/actions`, input, key);
    assert.equal(r.status, 200);
    const again = await f.reviewSend(
      `/risk-assessments/${f.doc.id}/actions`,
      input,
      key,
    );
    assert.equal(again.body.id, r.body.id);
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM risk_actions").get()?.n,
      1,
    );
  } finally {
    f.db.close();
  }
});
test("risk action schema23 to24 leaves accepted documents unchanged and creates no automatic tasks", async () => {
  const f = await acceptedSource();
  try {
    const before = f.db
      .prepare("SELECT * FROM risk_assessments WHERE id=?")
      .get(f.doc.id);
    f.db.exec(
      "DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE IF EXISTS education_catalog_use_stops; DROP TABLE IF EXISTS cost_baseline_statements; DROP TABLE IF EXISTS cost_baselines; DROP TABLE IF EXISTS ppe_return_entries; DROP TRIGGER IF EXISTS ppe_return_terminal_state; DROP TABLE IF EXISTS work_plan_review_events; DROP TABLE IF EXISTS work_plan_document_reviews; DROP TABLE IF EXISTS cost_stock_receipts; DROP TRIGGER IF EXISTS cost_stock_split_guard; DROP TRIGGER IF EXISTS cost_stock_split_undo_guard; DROP TABLE IF EXISTS minutes_followup_events; DROP TABLE IF EXISTS minutes_followups; DROP TABLE IF EXISTS minutes_snapshots; DROP TABLE IF EXISTS minutes_records; DROP TRIGGER IF EXISTS minutes_final_fixed; DROP TRIGGER IF EXISTS minutes_final_retained; DROP TABLE IF EXISTS tbm_risk_references; DROP TABLE IF EXISTS risk_reuse_sources; DROP TABLE IF EXISTS risk_publication_events; DROP TABLE IF EXISTS risk_publication_acks; DROP TABLE IF EXISTS risk_publication_targets; DROP TABLE IF EXISTS risk_publications; DROP TABLE IF EXISTS risk_opinion_events; DROP TABLE IF EXISTS risk_opinions; DROP TABLE IF EXISTS risk_residuals;DROP TABLE risk_action_events;DROP TABLE risk_actions;PRAGMA user_version=23",
    );
    const { migrateRiskActions } =
      await import("../server/risk-action-schema.js");
    migrateRiskActions(f.db);
    assert.deepEqual(
      f.db.prepare("SELECT * FROM risk_assessments WHERE id=?").get(f.doc.id),
      before,
    );
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM risk_actions").get()?.n,
      0,
    );
    assert.equal(f.db.prepare("PRAGMA user_version").get()?.user_version, 24);
  } finally {
    f.db.close();
  }
});
