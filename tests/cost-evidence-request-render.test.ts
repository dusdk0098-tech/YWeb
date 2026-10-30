import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CostEvidenceRequest } from "../src/CostEvidenceRequest.js";
test("request draft SSR shows manual initial load, no invented warning-free or send result", () => {
  const html = renderToStaticMarkup(createElement(CostEvidenceRequest, { siteId: "s", periodId: "p" }));
  assert.match(html, /후보 미조회/); assert.match(html, /경고가 없다는 뜻이 아닙니다/);
  assert.match(html, /현재 확인 후보 조회/); assert.match(html, /최대 50개/);
  assert.match(html, /법정 증빙 필요 여부/); assert.doesNotMatch(html, /발송 완료|수신 완료|mailto:|textarea/);
});
