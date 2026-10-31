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
test("hazard-level projected and after-confirmation records remain separate, high values allowed and material changes stale", async () => {
  const f = await acceptedSource();
  try {
    const base = `/risk-assessments/${f.doc.id}/hazards/${f.body.hazards[0].id}/residuals`,
      get = () => f.agent.get(f.base + base + "/context");
    let r = await get();
    assert.equal(r.status, 200);
    let c = r.body;
    const value = {
      kind: "projected",
      expectedVersion: 0,
      contextFingerprint: c.fingerprint,
      likelihood: 1,
      severity: 1,
      // Longer than the 2000-char hazard judgmentReason limit; residual basis allows 5000.
      basis: "Expected human basis, not observation".padEnd(3000, "."),
      claimedLocalDate: "2026-11-01",
      reason: "Projection",
      confirmManualEvaluation: true,
    };
    r = await f.reviewSend(base, value);
    assert.equal(r.status, 200);
    assert.equal(r.body.snapshot.result.score, 1);
    assert.equal(r.body.kind, "projected");
    r = await f.reviewSend(base, { ...value, kind: "after_confirmation" });
    assert.equal(r.status, 409);
    const actionIds: string[] = [];
    for (let index = 0; index < 2; index++) {
      r = await f.reviewSend(`/risk-assessments/${f.doc.id}/actions`, {
        version: 3,
        hazardId: f.body.hazards[0].id,
        planIndex: index,
        assigneeId: f.manager,
        due: "2026-11-02",
        reason: "Explicit",
        confirmManualTracking: true,
      });
      assert.equal(r.status, 200);
      const aid = r.body.id;
      actionIds.push(aid);
      r = await f.send("post", `/risk-actions/${aid}/report`, {
        version: 1,
        text: "Human report",
        claimedLocalDate: "2026-11-01",
        reason: "Report",
        confirmHumanReport: true,
      });
      assert.equal(r.status, 200);
      r = await f.reviewSend(`/risk-actions/${aid}/verify`, {
        version: 2,
        decision: "confirm",
        note: "Named human review",
        claimedLocalDate: "2026-11-02",
        reason: "Review",
        confirmHumanVerification: true,
      });
      assert.equal(r.status, 200);
      c = (await get()).body;
      if (index === 0) assert.equal(c.afterConfirmationReady, false);
    }
    assert.equal(c.afterConfirmationReady, true);
    assert.equal(c.versions.projected, 1);
    assert.equal(c.versions.after_confirmation, 0);
    const observed = {
      ...value,
      kind: "after_confirmation",
      contextFingerprint: c.fingerprint,
      likelihood: 5,
      severity: 4,
      basis: "Human evaluation still high despite reported actions",
      reason: "Further review needed",
    };
    const race = await Promise.all([
      f.reviewSend(base, observed),
      f.reviewSend(base, observed),
    ]);
    assert.deepEqual(race.map((x) => x.status).sort(), [200, 409]);
    const original = race.find((x) => x.status === 200)!.body.snapshot;
    assert.equal(original.result.score, 20);
    assert.equal(original.result.criterionAcceptable, false);
    assert.equal(original.context.actions.length, 2);
    assert.equal(original.context.actions[0].version, 3);
    assert.equal(original.kind, "after_confirmation");
    r = await f.agent.get(f.base + base);
    assert.equal(
      r.body.items.find((x: { kind: string }) => x.kind === "projected").stale,
      true,
    );
    assert.equal(
      r.body.items.find(
        (x: { kind: string }) => x.kind === "after_confirmation",
      ).stale,
      false,
    );
    // Profile text is irrelevant to the action-version fingerprint.
    f.db
      .prepare("UPDATE users SET name=? WHERE id=?")
      .run("Renamed synthetic", f.manager);
    assert.equal((await get()).body.fingerprint, c.fingerprint);
    r = await f.reviewSend(`/risk-actions/${actionIds[0]}/reopen`, {
      version: 3,
      reason: "New action information",
    });
    assert.equal(r.status, 200);
    r = await f.agent.get(f.base + base);
    const old = r.body.items.find(
      (x: { kind: string }) => x.kind === "after_confirmation",
    );
    assert.equal(old.stale, true);
    assert.deepEqual(old.snapshot, original);
    c = (await get()).body;
    assert.equal(c.afterConfirmationReady, false);
    r = await f.reviewSend(base, {
      ...observed,
      expectedVersion: 1,
      contextFingerprint: c.fingerprint,
    });
    assert.equal(r.status, 409);
    r = await f.reviewSend(`/risk-assessments/${f.doc.id}/revise`, {
      version: 3,
      reason: "Source revision",
      authorId: f.reviewer,
    });
    assert.equal(r.status, 200);
    c = (await get()).body;
    assert.equal(c.canRecord, false);
    assert.ok(c.facts.sourceSuccessorId);
    r = await f.reviewSend(base, {
      ...value,
      expectedVersion: 1,
      contextFingerprint: c.fingerprint,
    });
    assert.equal(r.status, 409);
    assert.throws(() =>
      f.db.prepare("UPDATE risk_residuals SET snapshot=?").run("{}"),
    );
    assert.throws(() => f.db.prepare("DELETE FROM risk_residuals").run());
  } finally {
    f.db.close();
  }
});
test("no-plan hazard remains assessed without fake mitigation; exact limits, append rollback and migration", async () => {
  const f = await acceptedSource();
  try {
    // A separate low-score document legitimately has no reduction plan.
    let r = await f.send("post", "/risk-assessments", {
      criteriaId: f.doc.criteria_id,
      body: {
        ...f.body,
        title: "No plan",
        hazards: [
          { ...f.body.hazards[0], plans: [], likelihood: 1, severity: 1 },
        ],
      },
    });
    assert.equal(r.status, 200);
    const id = r.body.id;
    r = await f.send("post", `/risk-assessments/${id}/submit`, {
      version: 1,
      reason: "No fake plan",
      confirmRecordOnly: true,
    });
    assert.equal(r.status, 200);
    r = await f.reviewSend(`/risk-assessments/${id}/review`, {
      version: 2,
      decision: "accepted",
      reason: "Document only",
      confirmRecordOnly: true,
    });
    assert.equal(r.status, 200);
    const base = `/risk-assessments/${id}/hazards/${f.body.hazards[0].id}/residuals`;
    r = await f.agent.get(f.base + base + "/context");
    const c = r.body;
    assert.equal(c.canRecord, true);
    assert.equal(c.afterConfirmationReady, false);
    assert.match(c.readinessNote, /허위 계획/);
    const v = {
      kind: "after_confirmation",
      expectedVersion: 0,
      contextFingerprint: c.fingerprint,
      likelihood: 1,
      severity: 1,
      basis: "Human basis",
      claimedLocalDate: "2026-11-01",
      reason: "Input",
      confirmManualEvaluation: true,
    };
    r = await f.reviewSend(base, v);
    assert.equal(r.status, 409);
    r = await f.reviewSend(base, { ...v, kind: "projected", likelihood: 0 });
    assert.equal(r.status, 400);
    r = await f.reviewSend(base, { ...v, kind: "projected", severity: 5 });
    assert.equal(r.status, 400);
    f.db.exec(
      "CREATE TRIGGER synthetic_residual_audit_failure BEFORE INSERT ON audit WHEN NEW.event='risk.residual.projected' BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END;",
    );
    r = await f.reviewSend(base, { ...v, kind: "projected" });
    assert.equal(r.status, 500);
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM risk_residuals").get()?.n,
      0,
    );
    f.db.exec("DROP TRIGGER synthetic_residual_audit_failure");
    const key = randomUUID();
    r = await f.reviewSend(base, { ...v, kind: "projected" }, key);
    assert.equal(r.status, 200);
    const again = await f.reviewSend(base, { ...v, kind: "projected" }, key);
    assert.equal(again.body.id, r.body.id);
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM risk_residuals").get()?.n,
      1,
    );
    f.db.exec(
      "DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE IF EXISTS education_catalog_use_stops; DROP TABLE IF EXISTS cost_baseline_statements; DROP TABLE IF EXISTS cost_baselines; DROP TABLE IF EXISTS ppe_return_entries; DROP TRIGGER IF EXISTS ppe_return_terminal_state; DROP TABLE IF EXISTS work_plan_review_events; DROP TABLE IF EXISTS work_plan_document_reviews; DROP TABLE IF EXISTS cost_stock_receipts; DROP TRIGGER IF EXISTS cost_stock_split_guard; DROP TRIGGER IF EXISTS cost_stock_split_undo_guard; DROP TABLE IF EXISTS minutes_followup_events; DROP TABLE IF EXISTS minutes_followups; DROP TABLE IF EXISTS minutes_snapshots; DROP TABLE IF EXISTS minutes_records; DROP TRIGGER IF EXISTS minutes_final_fixed; DROP TRIGGER IF EXISTS minutes_final_retained; DROP TABLE IF EXISTS tbm_risk_references; DROP TABLE IF EXISTS risk_reuse_sources; DROP TABLE IF EXISTS risk_publication_events; DROP TABLE IF EXISTS risk_publication_acks; DROP TABLE IF EXISTS risk_publication_targets; DROP TABLE IF EXISTS risk_publications; DROP TABLE IF EXISTS risk_opinion_events; DROP TABLE IF EXISTS risk_opinions; DROP TABLE risk_residuals;PRAGMA user_version=24",
    );
    const { migrateRiskResiduals } =
      await import("../server/risk-residual-schema.js");
    migrateRiskResiduals(f.db);
    assert.equal(
      f.db.prepare("SELECT status FROM risk_assessments WHERE id=?").get(id)
        ?.status,
      "accepted",
    );
    assert.equal(
      f.db.prepare("SELECT COUNT(*) n FROM risk_residuals").get()?.n,
      0,
    );
    assert.equal(f.db.prepare("PRAGMA user_version").get()?.user_version, 25);
  } finally {
    f.db.close();
  }
});
