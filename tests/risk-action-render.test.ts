import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RiskActionCreate } from "../src/RiskActionCreate.js";
import { RiskActionsPanel } from "../src/RiskActionsPanel.js";
const site = {
    id: "synthetic",
    name: "Synthetic",
    role: "manager" as const,
    version: 1,
  },
  noop = () => {};
test("risk action initial UI states manual separate tracking and no whole-hazard completion", () => {
  const html = renderToStaticMarkup(
    createElement(RiskActionCreate, {
      site,
      onClose: noop,
      onSaved: noop,
      onDirtyChange: noop,
      onBusyChange: noop,
    }),
  );
  assert.match(html, /다른 계획\/위험 전체가 자동 완료되지 않습니다/);
  assert.match(html, /실제 위험 허용이나 조치 완료를 뜻하지 않습니다/);
  const list = renderToStaticMarkup(
    createElement(RiskActionsPanel, {
      site: { ...site, role: "viewer" },
      user: {
        id: "synthetic",
        name: "Synthetic",
        email: "synthetic@example.test",
      },
      onDirtyChange: noop,
      onBusyChange: noop,
    }),
  );
  assert.doesNotMatch(list, /수락 문서의 계획 선택·수기 추적 시작/);
  assert.match(list, /위험행별 별도 재평가 기록은 평가 문서에서 조회/);
});
