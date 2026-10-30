import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RiskCriteriaEditor } from "../src/RiskCriteriaEditor.js";
import { RiskAssessmentEditor } from "../src/RiskAssessmentEditor.js";
const common = {
  site: {
    id: "synthetic",
    name: "Synthetic",
    role: "manager" as const,
    version: 1,
  },
  initial: null,
  onClose: () => {},
  onDirtyChange: () => {},
  onBusyChange: () => {},
  method: "three_level" as const,
};
test("three-level existing document shell uses human choice labels without numeric controls", () => {
  const criteria = renderToStaticMarkup(
    createElement(RiskCriteriaEditor, common),
  );
  assert.match(criteria, /3단계 판단 기준/);
  assert.match(criteria, /표시 순서일 뿐 점수 아님/);
  assert.equal((criteria.match(/서로 다른 단계 이름/g) || []).length, 3);
  assert.doesNotMatch(criteria, /사용자 정의 곱 점수 구간/);
  const assessment = renderToStaticMarkup(
    createElement(RiskAssessmentEditor, {
      ...common,
      user: {
        id: "synthetic",
        name: "Synthetic",
        email: "synthetic@example.test",
      },
    }),
  );
  assert.match(assessment, /사람 선택 3단계/);
  assert.doesNotMatch(assessment, /수치형만 지원/);
});
