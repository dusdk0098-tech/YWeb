import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { tbmRiskReferenceInput, summarizeTbmRiskSource, storeTbmRiskReference, tbmRiskReference } from "../server/tbm-risk-reference.js";
import { createTbmRiskReferenceTable } from "../server/tbm-risk-schema.js";
import { methodAssessmentInput } from "../server/risk-methods.js";
const a = randomUUID(), siteId = randomUUID(), h = randomUUID(), hash = "a".repeat(64);
function submission(method: "product" | "three_level" | "checklist" | "narrative") {
  const common = { id: h, task: "합성 작업", location: "합성 장소", category: "", accidentType: "", scenario: "위험 설명", harm: "피해 설명", exposedGroup: "", reference: "", currentControls: "제출 당시 조치", judgmentReason: "", plans: [] };
  const methodFields = method === "product" ? {likelihood: 1, severity: 1} : method === "three_level" ? {levelId: null} : method === "checklist" ? {checklistItemId: null, outcome: null} : {exposurePath: "", additionalPlanDecision: null};
  return { id: a, siteId, version: 3, body: methodAssessmentInput.parse({title: "합성 평가", date: "2026-10-28", timing: "최초", trigger: "", workScope: "", method, hazards: [{...common, ...methodFields}]}) };
}
test("TBM risk reference selects stable descriptive rows for all four methods without outcomes or attendance", () => {
  for (const method of ["product", "three_level", "checklist", "narrative"] as const) {
    const fixed = summarizeTbmRiskSource(submission(method), hash, [h]);
    assert.equal(fixed.method, method);
    assert.equal(fixed.submissionHash, hash);
    assert.deepEqual(Object.keys(fixed.hazards[0]), ["id", "task", "location", "scenario", "harm", "currentControls"]);
    assert.throws(() => summarizeTbmRiskSource(submission(method), hash, [randomUUID()]), /고정 제출본/);
  }
});
test("TBM reference input is strict and selected IDs are explicit and unique", () => {
  const source = {assessmentId: a, submissionVersion: 3, submissionHash: hash, hazardIds: [h]};
  assert.equal(tbmRiskReferenceInput.safeParse({version: 1, source}).success, true);
  assert.equal(tbmRiskReferenceInput.safeParse({version: 1, source: null}).success, true);
  for (const invalid of [{...source, hazardIds: []}, {...source, hazardIds: [h,h]}, {...source, hazardIds: Array.from({length:51}, () => randomUUID())}, {...source, title: "client-written"}, {...source, submissionHash: "bad"}])
    assert.equal(tbmRiskReferenceInput.safeParse({version: 1, source: invalid}).success, false);
});
test("TBM reference table preserves finalized data and never invents legacy references", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE tbm_sessions(id TEXT PRIMARY KEY,status TEXT); CREATE TABLE risk_assessments(id TEXT PRIMARY KEY); INSERT INTO tbm_sessions VALUES('old','finalized'),('new','draft')");
    db.prepare("INSERT INTO risk_assessments VALUES(?)").run(a);
    createTbmRiskReferenceTable(db);
    assert.equal(tbmRiskReference(db, "old"), null);
    const ref = summarizeTbmRiskSource(submission("product"), hash, [h]);
    storeTbmRiskReference(db, "new", ref);
    assert.deepEqual(tbmRiskReference(db, "new"), ref);
    storeTbmRiskReference(db, "new", null);
    assert.equal(tbmRiskReference(db, "new"), null);
    storeTbmRiskReference(db, "new", ref);
    db.exec("UPDATE tbm_sessions SET status='finalized' WHERE id='new'");
    assert.throws(() => storeTbmRiskReference(db, "new", null), /immutable/);
    assert.throws(() => storeTbmRiskReference(db, "old", ref), /requires draft/);
  } finally { db.close(); }
});
