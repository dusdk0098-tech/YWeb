import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import {
  riskCriteriaInput,
  riskAssessmentInput,
  validateRiskCriteria,
  riskResults,
} from "../server/risk-model.js";
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
test("risk numeric criteria require human descriptions and exhaustive nonoverlapping attainable-product bands", () => {
  validateRiskCriteria(criteria);
  assert.throws(() => validateRiskCriteria({ ...criteria, rationale: "" }));
  assert.throws(() =>
    validateRiskCriteria({
      ...criteria,
      bands: [{ min: 1, max: 19, label: "gap20", criterionAcceptable: false }],
    }),
  );
  assert.throws(() =>
    validateRiskCriteria({
      ...criteria,
      bands: [
        ...criteria.bands,
        { min: 5, max: 6, label: "overlap", criterionAcceptable: false },
      ],
    }),
  );
  assert.throws(() =>
    validateRiskCriteria({ ...criteria, likelihood: ["", "2"] }),
  );
  assert.equal(
    riskCriteriaInput.safeParse({ ...criteria, method: "checklist" }).success,
    false,
  );
  const body = draft();
  assert.equal(riskResults(body, null)[0].score, null);
  for (let l = 1; l <= 5; l++)
    for (let s = 1; s <= 4; s++) {
      body.hazards[0].likelihood = l;
      body.hazards[0].severity = s;
      const r = riskResults(body, criteria)[0];
      assert.equal(r.score, l * s);
      assert.equal(r.criterionAcceptable, l * s <= 5);
      assert.equal(r.reductionPlanMissing, l * s > 5);
    }
  assert.throws(() => riskResults(body, null));
  assert.throws(() =>
    riskResults(body, { ...criteria, likelihood: ["1", "2"] }),
  );
  assert.equal(
    riskAssessmentInput.safeParse({
      ...body,
      hazards: [body.hazards[0], body.hazards[0]],
    }).success,
    false,
  );
  assert.equal(
    riskAssessmentInput.safeParse({
      ...body,
      hazards: Array.from({ length: 51 }, hazard),
    }).success,
    false,
  );
  assert.equal(
    riskAssessmentInput.safeParse({ ...body, date: "2026-02-29" }).success,
    false,
  );
});
test("risk criteria snapshots remain fixed, drafts preserve timing, nullable arithmetic and explicit replacement history", async () => {
  const f = await setup();
  try {
    let r = await f.send("post", "/risk-criteria", { ...criteria, bands: [] });
    assert.equal(r.status, 200);
    const cid = r.body.id;
    r = await f.send("post", `/risk-criteria/${cid}/confirm`, {
      version: 1,
      reason: "Synthetic confirm",
      confirmHumanCriteria: true,
    });
    assert.equal(r.status, 400);
    r = await f.send("put", `/risk-criteria/${cid}`, {
      version: 1,
      body: criteria,
      reason: "Synthetic complete",
    });
    assert.equal(r.status, 200);
    r = await f.send("post", `/risk-criteria/${cid}/confirm`, {
      version: 2,
      reason: "Human test confirmation",
      confirmHumanCriteria: true,
    });
    assert.equal(r.status, 200);
    const frozen = r.body.confirmed_snapshot;
    assert.equal(frozen.version, 3);
    r = await f.send("put", `/risk-criteria/${cid}`, {
      version: 3,
      body: criteria,
      reason: "cannot overwrite",
    });
    assert.equal(r.status, 409);
    const body = draft();
    r = await f.send("post", "/risk-assessments", { body, criteriaId: cid });
    assert.equal(r.status, 200);
    let record = r.body;
    assert.equal(record.results[0].score, null);
    assert.equal(record.status, "draft");
    body.hazards[0].likelihood = 5;
    body.hazards[0].severity = 4;
    body.hazards[0].judgmentReason = "Human synthetic basis";
    r = await f.send("put", `/risk-assessments/${record.id}`, {
      version: 1,
      body,
      reason: "Human values",
    });
    assert.equal(r.status, 200);
    record = r.body;
    assert.equal(record.results[0].score, 20);
    assert.equal(record.results[0].reductionPlanMissing, true);
    assert.equal(record.body.timing, "수시");
    r = await f.send("post", `/risk-criteria/${cid}/revise`, {
      version: 3,
      reason: "Next criteria",
    });
    assert.equal(r.status, 200);
    const next = r.body.id;
    r = await f.send("put", `/risk-criteria/${next}`, {
      version: 1,
      body: {
        ...criteria,
        name: "New",
        bands: [
          { min: 1, max: 20, label: "Changed", criterionAcceptable: true },
        ],
      },
      reason: "New human values",
    });
    assert.equal(r.status, 200);
    r = await f.send("post", `/risk-criteria/${next}/confirm`, {
      version: 2,
      reason: "Confirm next",
      confirmHumanCriteria: true,
    });
    assert.equal(r.status, 200);
    r = await f.agent.get(f.base + `/risk-assessments/${record.id}`);
    assert.deepEqual(r.body.criteria_snapshot, frozen);
    assert.equal(r.body.results[0].criterionAcceptable, false);
    r = await f.send("post", `/risk-assessments/${record.id}/criteria`, {
      version: 2,
      criteriaId: next,
      reason: "Explicit replacement",
      confirmResetValues: false,
    });
    assert.equal(r.status, 400);
    r = await f.send("post", `/risk-assessments/${record.id}/criteria`, {
      version: 2,
      criteriaId: next,
      reason: "Explicit replacement",
      confirmResetValues: true,
    });
    assert.equal(r.status, 200);
    record = r.body;
    assert.equal(record.results[0].score, null);
    assert.equal(record.body.hazards[0].judgmentReason, "");
    r = await f.agent.get(f.base + `/risk-assessments/${record.id}/events`);
    assert.equal(r.body.items.length, 3);
    assert.equal(JSON.parse(r.body.items[1].snapshot).results[0].score, 20);
    const key = randomUUID();
    r = await f.send(
      "post",
      "/risk-assessments",
      { body: draft(), criteriaId: null },
      key,
    );
    assert.equal(r.status, 200);
    const id = r.body.id;
    const replay = await f.send(
      "post",
      "/risk-assessments",
      { body: r.body.body, criteriaId: null },
      key,
    );
    assert.equal(replay.status, 200);
    assert.equal(replay.body.id, id);
    const races = await Promise.all([
      f.send("put", `/risk-assessments/${id}`, {
        version: 1,
        body: r.body.body,
        reason: "One",
      }),
      f.send("put", `/risk-assessments/${id}`, {
        version: 1,
        body: r.body.body,
        reason: "Two",
      }),
    ]);
    assert.deepEqual(races.map((x) => x.status).sort(), [200, 409]);
    f.db.exec(
      "CREATE TRIGGER synthetic_risk_fault BEFORE INSERT ON risk_events BEGIN SELECT RAISE(ABORT,'synthetic business rollback'); END;",
    );
    const count = f.db.prepare("SELECT COUNT(*) n FROM risk_assessments").get()!
      .n;
    r = await f.send("post", "/risk-assessments", {
      body: draft(),
      criteriaId: null,
    });
    assert.equal(r.status, 500);
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM risk_assessments").get()!.n,
      count,
    );
  } finally {
    f.db.close();
  }
});
test("risk draft exact50 rows and10 plans remain drafts; schema21 migration preserves company data", async () => {
  const f = await setup();
  try {
    const body = draft();
    body.hazards = Array.from({ length: 50 }, hazard);
    body.hazards[0].plans = Array.from({ length: 10 }, () => ({
      action: "Human plan",
      controlType: "미정" as const,
      ownerNote: "Group",
      due: null,
      priorityNote: "",
      preconditions: "",
    }));
    let r = await f.send("post", "/risk-assessments", {
      body,
      criteriaId: null,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.results.length, 50);
    assert.ok(r.body.results.every((v: { score: null }) => v.score === null));
    body.hazards[0].plans.push(body.hazards[0].plans[0]);
    assert.equal(riskAssessmentInput.safeParse(body).success, false);
    r = await f.send("post", "/companies", { name: "Preserved company" });
    assert.equal(r.status, 200);
    f.db.exec(
      "DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE IF EXISTS education_catalog_use_stops; DROP TABLE IF EXISTS cost_baseline_statements; DROP TABLE IF EXISTS cost_baselines; DROP TABLE IF EXISTS ppe_return_entries; DROP TRIGGER IF EXISTS ppe_return_terminal_state; DROP TABLE IF EXISTS work_plan_review_events; DROP TABLE IF EXISTS work_plan_document_reviews; DROP TABLE IF EXISTS cost_stock_receipts; DROP TRIGGER IF EXISTS cost_stock_split_guard; DROP TRIGGER IF EXISTS cost_stock_split_undo_guard; DROP TABLE IF EXISTS minutes_followup_events; DROP TABLE IF EXISTS minutes_followups; DROP TABLE IF EXISTS minutes_snapshots; DROP TABLE IF EXISTS minutes_records; DROP TRIGGER IF EXISTS minutes_final_fixed; DROP TRIGGER IF EXISTS minutes_final_retained; DROP TABLE IF EXISTS tbm_risk_references; DROP TABLE IF EXISTS risk_reuse_sources; DROP TABLE IF EXISTS risk_publication_events; DROP TABLE IF EXISTS risk_publication_acks; DROP TABLE IF EXISTS risk_publication_targets; DROP TABLE IF EXISTS risk_publications; DROP TABLE IF EXISTS risk_opinion_events; DROP TABLE IF EXISTS risk_opinions; DROP TABLE IF EXISTS risk_residuals;DROP TABLE IF EXISTS risk_action_events;DROP TABLE IF EXISTS risk_actions;DROP TABLE risk_events;DROP TABLE risk_assessments;DROP TABLE risk_criteria;PRAGMA user_version=21",
    );
    const { migrateRiskCore } = await import("../server/risk-schema.js");
    migrateRiskCore(f.db);
    assert.equal(f.db.prepare("PRAGMA user_version").get()?.user_version, 22);
    assert.equal(
      f.db.prepare("SELECT name FROM companies WHERE id=?").get(r.body.id)
        ?.name,
      "Preserved company",
    );
    assert.deepEqual(f.db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    f.db.close();
  }
});
