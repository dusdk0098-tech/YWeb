import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  narrativeCriteriaInput, validateNarrativeCriteria, emptyNarrativeQuestions,
  narrativeAssessmentInput, narrativeResults, type NarrativeAssessment,
} from "../server/risk-narrative-model.js";
const criteria = () => ({
  name: "Synthetic narrative", method: "narrative" as const,
  rationale: "Independently authored guidance, no standard rubric",
  questions: Object.fromEntries(Object.keys(emptyNarrativeQuestions()).map((key) =>
    [key, { prompt: `Own ${key} question`, guidance: `Own ${key} guidance` }])) as ReturnType<typeof emptyNarrativeQuestions>,
});
const body = (): NarrativeAssessment => ({
  title: "Synthetic", date: "2026-10-28", timing: "수시", trigger: "Synthetic", workScope: "Synthetic", method: "narrative",
  hazards: [{
    id: randomUUID(), task: "Synthetic task", location: "", category: "", accidentType: "",
    scenario: "Human-described hazard", harm: "Human-described harm", exposedGroup: "Generic group",
    reference: "Human evidence note", currentControls: "Human-described current controls",
    judgmentReason: "Further judgment required; no resolution claim", plans: [],
    exposurePath: "Human-described route", additionalPlanDecision: "further_review",
  }],
});
test("narrative criteria require six authored semantic prompts without legal defaults", () => {
  const c = criteria();
  validateNarrativeCriteria(narrativeCriteriaInput.parse(c));
  assert.throws(() => validateNarrativeCriteria({ ...c, questions: emptyNarrativeQuestions() }));
  assert.equal(narrativeCriteriaInput.safeParse({ ...c, questions: { ...c.questions, extra: { prompt: "Q", guidance: "G" } } }).success, false);
  const { exposurePath, ...missing } = c.questions;
  void exposurePath;
  assert.equal(narrativeCriteriaInput.safeParse({ ...c, questions: missing }).success, false);
  assert.equal(narrativeCriteriaInput.safeParse({ ...c, levels: [] }).success, false);
});
test("narrative unresolved judgment is explicit while missing input and planned actions remain distinct", () => {
  const c = criteria(), b = body();
  const r = narrativeResults(narrativeAssessmentInput.parse(b), c)[0];
  assert.equal(r.score, null);
  assert.equal(r.criterionAcceptable, null);
  assert.equal(r.judgmentUnresolved, true);
  assert.equal(r.incomplete, false);
  assert.equal(r.reductionPlanMissing, false);
  const h = b.hazards[0];
  assert.equal(narrativeResults({ ...b, hazards: [{ ...h, additionalPlanDecision: null }] }, c)[0].incomplete, true);
  assert.equal(narrativeResults({ ...b, hazards: [{ ...h, additionalPlanDecision: "planned" }] }, c)[0].reductionPlanMissing, true);
  const none = narrativeResults({ ...b, hazards: [{ ...h, additionalPlanDecision: "none_proposed" }] }, c)[0];
  assert.equal(none.criterionAcceptable, null);
  assert.match(none.bandLabel!, /안전 판정 아님/);
  assert.equal(narrativeResults({ ...b, hazards: [{ ...h, exposurePath: "" }] }, c)[0].incomplete, true);
  assert.equal(narrativeResults(b, null)[0].incomplete, true);
});
test("narrative rejects numeric and other method fields and preserves explicit pending value", () => {
  const b = body();
  for (const fields of [{ likelihood: 1 }, { severity: 1 }, { levelId: randomUUID() }, { outcome: "compliant" }, { score: 0 }])
    assert.equal(narrativeAssessmentInput.safeParse({ ...b, hazards: [{ ...b.hazards[0], ...fields }] }).success, false);
  assert.equal(narrativeAssessmentInput.safeParse({ ...b, hazards: [b.hazards[0], b.hazards[0]] }).success, false);
  assert.equal(narrativeAssessmentInput.safeParse({ ...b, hazards: Array.from({ length: 50 }, () => ({ ...b.hazards[0], id: randomUUID() })) }).success, true);
  assert.equal(narrativeAssessmentInput.safeParse({ ...b, hazards: Array.from({ length: 51 }, () => ({ ...b.hazards[0], id: randomUUID() })) }).success, false);
});
