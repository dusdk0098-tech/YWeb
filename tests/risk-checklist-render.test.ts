import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RiskCriteriaEditor } from "../src/RiskCriteriaEditor.js";
import { RiskHazardFields } from "../src/RiskHazardFields.js";
test("checklist controls distinguish pending and NA without score controls", () => {
  const noop = () => {};
  const html = renderToStaticMarkup(
    createElement(RiskCriteriaEditor, {
      site: { id: "s", name: "S", role: "manager", version: 1 },
      initial: null,
      method: "checklist",
      onClose: noop,
      onDirtyChange: noop,
      onBusyChange: noop,
    }),
  );
  assert.match(html, /체크리스트 판단 기준/);
  assert.match(html, /빈 체크항목 추가/);
  assert.doesNotMatch(html, /사용자 정의 곱 점수 구간/);
  const fields = renderToStaticMarkup(
    createElement(RiskHazardFields, {
      h: {
        id: "h",
        task: "",
        location: "",
        category: "",
        accidentType: "",
        scenario: "",
        harm: "",
        exposedGroup: "",
        reference: "",
        currentControls: "",
        judgmentReason: "",
        plans: [],
        checklistItemId: null,
        outcome: null,
      },
      i: 0,
      disabled: false,
      criteria: null,
      change: noop,
      onRemove: noop,
    }),
  );
  assert.match(fields, /응답 대기 \(적합 아님\)/);
  assert.match(fields, /해당없음 \(사유 필요\)/);
  assert.doesNotMatch(fields, />가능성<|>중대성</);
});
