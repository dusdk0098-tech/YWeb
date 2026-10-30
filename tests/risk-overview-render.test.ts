import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RiskOverviewPanel, RiskOverviewSummary } from "../src/RiskOverviewPanel.js";
import type { RiskOverview } from "../server/risk-overview.js";
test("risk overview initial markup explains current-state scope and pending evidence limits", () => {
  const html = renderToStaticMarkup(createElement(RiskOverviewPanel, { site: { id: "s", name: "<script>synthetic</script>", role: "viewer", version: 1 } }));
  assert.match(html, /과거 시점 재현이 아닙니다/);
  assert.match(html, /이전 문서의 미확인 조치/);
  assert.match(html, /재평가 누락·참조 변경/);
  assert.match(html, /체크리스트 항목별 판단/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
test("risk overview summary distinguishes reported and verified records without safety conclusions", () => {
  const documents = () => ({ draft: 0, submitted: 2, accepted: 0, returned: 0 });
  const actions = () => ({ assigned: { beforeDate: 3, onDate: 0, afterDate: 0 }, reported: { beforeDate: 1, onDate: 0, afterDate: 0 }, verified: { beforeDate: 0, onDate: 1, afterDate: 0 } });
  const report: RiskOverview = { siteId: "s", asOfDate: "2026-10-28", method: "checklist", generatedAt: "synthetic", groups: [{ method: "checklist", documents: { currentLeaf: documents(), priorWithSuccessor: documents() }, actions: { currentLeaf: actions(), priorWithSuccessor: actions() } }] };
  const html = renderToStaticMarkup(createElement(RiskOverviewSummary, { report }));
  assert.match(html, /체크리스트 항목별 판단/);
  assert.match(html, /문서 검토 대기 2건/);
  assert.match(html, /다른 관리자 확인 기록 대기/);
  assert.match(html, /사람 확인 기록 있음/);
  assert.match(html, /실제 미이행·법적 지연으로 판정하지 않습니다/);
  assert.match(html, /후속 문서가 있는 이전 문서와 그 조치/);
});
