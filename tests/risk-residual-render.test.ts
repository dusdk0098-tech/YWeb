import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RiskResidualPanel, residualKind } from "../src/RiskResidualPanel.js";
test("residual initial markup separates projected from after-confirmation human input without observation claim", () => {
  const html = renderToStaticMarkup(
    createElement(RiskResidualPanel, {
      site: { id: "synthetic", name: "Synthetic", role: "manager", version: 1 },
      assessmentId: "synthetic",
      hazardId: "synthetic",
      onClose: () => {},
      onDirtyChange: () => {},
      onBusyChange: () => {},
    }),
  );
  assert.match(html, /예상값을 실행 후 값으로 자동 전환하지 않습니다/);
  assert.match(html, /소프트웨어 관측\/독립기관 인증이 아닙니다/);
  assert.equal(residualKind.after_confirmation, "조치 확인 후 입력한 재평가");
});

import { RiskResidualValues, residualValueLabel } from "../src/RiskResidualValues.js";
import type { ResidualSnapshot } from "../server/risk-residuals.js";
test("three-level residual controls expose human definitions without numeric inputs", () => {
  const html = renderToStaticMarkup(createElement(RiskResidualValues, {
    criteria: {
      name: "Synthetic human criteria", method: "three_level", rationale: "Human criteria",
      levels: [0, 1, 2].map((i) => ({ id: String(i), label: `Human ${i}`, description: `Definition ${i}`, criterionAcceptable: i === 0 })),
    },
    likelihood: "", severity: "", levelId: "", setLikelihood: () => {}, setSeverity: () => {}, setLevelId: () => {},
  }));
  assert.match(html, /사람이 선택한 재평가 단계/);
  assert.match(html, /미선택 \(0점\/허용 아님\)/);
  assert.match(html, /Human 2: Definition 2/);
  assert.doesNotMatch(html, />가능성|>중대성/);
  const label = residualValueLabel({ method: "three_level", result: { bandLabel: "Human judgment", score: null } } as ResidualSnapshot);
  assert.equal(label, "사람 선택 Human judgment (숫자 점수 없음)");
});
