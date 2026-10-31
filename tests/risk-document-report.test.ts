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

import {
  readRiskDocument,
  assertRiskReportBounds,
  RISK_REPORT_MAX_BYTES,
  RISK_REPORT_HTML_MAX_BYTES,
} from "../server/risk-document-report.js";
test("fixed risk document print separates current summaries, escapes input and refuses stale context", async () => {
  const f = await acceptedSource();
  try {
    const id = f.doc.id,
      base = `/risk-assessments/${id}`,
      changes = f.db.prepare("SELECT total_changes() n").get()!.n;
    const original = readRiskDocument(f.db, f.site, id, () => {});
    assert.equal(f.db.prepare("SELECT total_changes() n").get()!.n, changes);
    assert.equal(original.actions.length, 0);
    assert.equal(original.residuals.length, 0);
    assert.equal(original.submission.version, 2);
    assert.equal(original.document.currentVersion, 3);
    f.db
      .prepare("UPDATE sites SET name=? WHERE id=?")
      .run("<synthetic & site>", f.site);
    let r = await f.agent.get(f.base + base + "/print-context");
    assert.equal(r.status, 200);
    const first = r.body.fingerprint;
    r = await f.agent.get(
      f.base + base + "/print?expectedFingerprint=" + first,
    );
    assert.equal(r.status, 200);
    assert.match(r.text, /&lt;synthetic &amp; site&gt;/);
    assert.doesNotMatch(r.text, /<synthetic/);
    assert.match(r.text, /고정 제출 원문/);
    assert.match(r.text, /조치 기록 미연결/);
    assert.match(r.text, /기록 없음 \(0점\/안전\/완료가 아님\)/);
    assert.match(r.text, /<link rel="stylesheet" href="\/print.css">/);
    assert.doesNotMatch(r.text, /<style|<script|<iframe|https?:\/\//);
    assert.match(r.headers["content-security-policy"], /style-src 'self'/);
    r = await f.reviewSend(base + "/actions", {
      version: 3,
      hazardId: f.body.hazards[0].id,
      planIndex: 0,
      assigneeId: f.manager,
      due: "2026-11-02",
      reason: "Tracking",
      confirmManualTracking: true,
    });
    assert.equal(r.status, 200);
    const aid = r.body.id;
    r = await f.agent.get(
      f.base + base + "/print?expectedFingerprint=" + first,
    );
    assert.equal(r.status, 409);
    r = await f.send("post", `/risk-actions/${aid}/report`, {
      version: 1,
      text: "<human-report> & only",
      claimedLocalDate: "2026-11-01",
      reason: "Human report",
      confirmHumanReport: true,
    });
    assert.equal(r.status, 200);
    const residual = base + `/hazards/${f.body.hazards[0].id}/residuals`;
    r = await f.agent.get(f.base + residual + "/context");
    let c = r.body;
    r = await f.reviewSend(residual, {
      kind: "projected",
      expectedVersion: 0,
      contextFingerprint: c.fingerprint,
      likelihood: 1,
      severity: 1,
      basis: "Expected only <basis>",
      claimedLocalDate: "2026-11-02",
      reason: "First",
      confirmManualEvaluation: true,
    });
    assert.equal(r.status, 200);
    r = await f.reviewSend(residual, {
      kind: "projected",
      expectedVersion: 1,
      contextFingerprint: c.fingerprint,
      likelihood: 5,
      severity: 4,
      basis: "Higher expected <basis>",
      claimedLocalDate: "2026-11-02",
      reason: "Correction",
      confirmManualEvaluation: true,
    });
    assert.equal(r.status, 200);
    r = await f.reviewSend(`/risk-actions/${aid}/assign`, {
      version: 2,
      assigneeId: f.reviewer,
      due: "2026-11-03",
      reason: "Changed responsibility",
    });
    assert.equal(r.status, 200);
    c = readRiskDocument(f.db, f.site, id, () => {});
    assert.deepEqual(c.submission, original.submission);
    assert.equal(c.counts.allResidualHistoryRecords, 2);
    assert.equal(c.residuals.length, 1);
    assert.equal(c.residuals[0].version, 2);
    assert.equal(c.residuals[0].stale, true);
    assert.equal(c.residuals[0].result.score, 20);
    r = await f.agent.get(
      f.base + base + "/print?expectedFingerprint=" + c.fingerprint,
    );
    assert.equal(r.status, 200);
    assert.match(r.text, /전체 이력 2개 중/);
    assert.match(r.text, /참조 변경됨/);
    assert.match(r.text, /추가 검토 필요/);
    assert.match(r.text, /Higher expected &lt;basis&gt;/);
    assert.doesNotMatch(r.text, /Expected only &lt;basis&gt;/);
    r = await f.reviewSend(base + "/revise", {
      version: 3,
      reason: "Source correction",
      authorId: f.reviewer,
    });
    assert.equal(r.status, 200);
    const child = r.body.nextDraft.id;
    r = await f.agent.get(f.base + `/risk-assessments/${child}/print-context`);
    assert.equal(r.status, 409);
    const latest = readRiskDocument(f.db, f.site, id, () => {});
    assert.deepEqual(latest.submission, original.submission);
    r = await f.agent.get(
      f.base + base + "/print?expectedFingerprint=" + latest.fingerprint,
    );
    assert.equal(r.status, 200);
    assert.match(r.text, /후속 문서 존재/);
    assert.match(r.text, new RegExp(child));
  } finally {
    f.db.close();
  }
});
test("risk report exact byte/count boundaries refuse overflow instead of silent truncation", () => {
  const counts = { hazards: 50, actions: 500, residuals: 100 };
  // Source facts above the 256KiB export limit stay printable/exportable (long action texts).
  assertRiskReportBounds("x".repeat(RISK_REPORT_MAX_BYTES), counts);
  assertRiskReportBounds("x".repeat(RISK_REPORT_HTML_MAX_BYTES - 2), counts);
  assert.throws(() =>
    assertRiskReportBounds("x".repeat(RISK_REPORT_HTML_MAX_BYTES - 1), counts),
  );
  for (const key of ["hazards", "actions", "residuals"] as const)
    assert.throws(() =>
      assertRiskReportBounds(null, { ...counts, [key]: counts[key] + 1 }),
    );
});
test("risk print refuses expanded HTML limit on a valid bounded source document", async () => {
  const f = await acceptedSource();
  try {
    const body = {
      ...f.body,
      title: "Long printable source",
      hazards: Array.from({ length: 50 }, () => ({
        ...f.body.hazards[0],
        id: randomUUID(),
        task: "&".repeat(2000),
        scenario: "&".repeat(2000),
        likelihood: 1,
        severity: 1,
        plans: [],
      })),
    };
    let r = await f.send("post", "/risk-assessments", {
      body,
      criteriaId: f.doc.criteria_id,
    });
    assert.equal(r.status, 200);
    const id = r.body.id;
    r = await f.send("post", `/risk-assessments/${id}/submit`, {
      version: 1,
      reason: "Synthetic complete source",
      confirmRecordOnly: true,
    });
    assert.equal(r.status, 200);
    r = await f.agent.get(f.base + `/risk-assessments/${id}/print-context`);
    assert.equal(r.status, 200);
    const fingerprint = r.body.fingerprint;
    r = await f.agent.get(
      f.base +
        `/risk-assessments/${id}/print?expectedFingerprint=${fingerprint}`,
    );
    assert.equal(r.status, 400);
    assert.match(r.body.error, /HTML1MiB/);
  } finally {
    f.db.close();
  }
});
