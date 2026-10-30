import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RiskPrintControl } from "../src/RiskPrintControl.js";
test("risk print initial control separates frozen source and current supplements and discloses unverified PDF", () => {
  const html = renderToStaticMarkup(
    createElement(RiskPrintControl, {
      site: { id: "synthetic", name: "Synthetic", role: "viewer", version: 1 },
      assessmentId: "synthetic",
      disabled: false,
      onBusyChange: () => {},
    }),
  );
  assert.match(html, /원 제출본과 조회 시점 조치\/재평가를 별도 표시/);
  assert.match(html, /실제 브라우저\/PDF 페이지 검증 미완료/);
  assert.doesNotMatch(html, /<a /);
  assert.match(html, /HTML \/ JSON/);
  assert.match(html, /현재 조회로 HTML\/JSON 준비/);
});
