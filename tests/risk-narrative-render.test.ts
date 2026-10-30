import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NarrativeCriteriaFields } from "../src/NarrativeCriteriaFields.js";
import { NarrativeHazardFields } from "../src/NarrativeHazardFields.js";
import { emptyNarrativeQuestions } from "../server/risk-narrative-model.js";
test("narrative initial controls expose authored prompts and unresolved judgment without scores", () => {
  const noop = () => {};
  const criteria = { name: "Synthetic", method: "narrative" as const, rationale: "", questions: emptyNarrativeQuestions() };
  const editor = renderToStaticMarkup(createElement(NarrativeCriteriaFields, { body: criteria, onChange: noop }));
  assert.match(editor, /자체 질문/);
  assert.match(editor, /법정 표준 양식이나 안전 판정 규칙이 아닙니다/);
  const fields = renderToStaticMarkup(createElement(NarrativeHazardFields, {
    h: { id: "h", task: "", location: "", category: "", accidentType: "", scenario: "", harm: "", exposedGroup: "", reference: "", currentControls: "", judgmentReason: "", plans: [], exposurePath: "", additionalPlanDecision: "further_review" },
    criteria, change: noop,
  }));
  assert.match(fields, /판단 미확정/);
  assert.match(fields, /문서가 수락되어도/);
  assert.match(fields, /미선택 \(판단 기록 전\)/);
  assert.doesNotMatch(fields, />가능성|>중대성|value="compliant"/);
});

import { RiskCriteriaEditor } from "../src/RiskCriteriaEditor.js";
import { RiskAssessmentEditor } from "../src/RiskAssessmentEditor.js";
test("integrated narrative editors identify their method and do not offer numeric controls", () => {
  const noop = () => {};
  const site = { id: "s", name: "Synthetic", role: "manager" as const, version: 1 };
  const criteria = renderToStaticMarkup(createElement(RiskCriteriaEditor, {
    site, initial: null, method: "narrative", onClose: noop, onDirtyChange: noop, onBusyChange: noop,
  }));
  assert.match(criteria, /핵심요인 서술형 기준/);
  assert.doesNotMatch(criteria, /사용자 정의 곱 점수 구간/);
  const assessment = renderToStaticMarkup(createElement(RiskAssessmentEditor, {
    site, user: { id: "u", name: "Synthetic", email: "synthetic@example.test" }, initial: null, method: "narrative", onClose: noop, onDirtyChange: noop, onBusyChange: noop,
  }));
  assert.match(assessment, /핵심요인 서술형/);
  assert.doesNotMatch(assessment, /방법:.*체크리스트 항목별 사람 판단/);
});
