import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TbmRiskReferenceView } from "../src/TbmRiskReferenceView.js";
test("TBM reference renders escaped historical source without lecture/signature claims", () => {
  const html = renderToStaticMarkup(createElement(TbmRiskReferenceView, {
    sourceHasSuccessor: true, historicalAtFinalization: true,
    reference: {schemaVersion: 1, assessmentId: "source-id", siteId: "site-id", submissionVersion: 3, submissionHash: "a".repeat(64), title: "<script>source</script>", date: "2026-10-28", method: "narrative", hazards: []},
  }));
  assert.ok(html.includes("&lt;script&gt;source&lt;/script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("현재 조회: 후속 평가"));
  assert.ok(html.includes("확정 당시"));
  assert.ok(html.includes("증명하지 않습니다"));
  assert.ok(renderToStaticMarkup(createElement(TbmRiskReferenceView, {reference: null})).includes("과거 출처를 추정하지 않습니다"));
});
