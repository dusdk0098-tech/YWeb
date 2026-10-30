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
};
test("risk criteria initial rendering has empty definitions and no default acceptable thresholds", () => {
  const html = renderToStaticMarkup(createElement(RiskCriteriaEditor, common));
  assert.match(html, /법정 기본/);
  assert.match(html, /안전 판정·작업 허가가 아닙니다/);
  assert.doesNotMatch(html, /checked=""/);
  assert.match(html, /빈 구간 추가/);
});
test("risk draft initial rendering distinguishes timing, unassessed source and incomplete workflow", () => {
  const html = renderToStaticMarkup(
    createElement(RiskAssessmentEditor, {
      ...common,
      user: {
        id: "synthetic",
        name: "Synthetic",
        email: "synthetic@example.test",
      },
    }),
  );
  assert.match(html, /미검토\/미승인/);
  assert.match(html, /미선택: 산출값 미평가/);
  assert.match(html, /평가 시기/);
  assert.match(html, /실제 이행·검증 완료와 다릅니다/);
});
test("risk review actions explicitly separate document acceptance from actual danger permission", async () => {
  const { RiskReviewActions } = await import("../src/RiskReviewActions.js");
  const row = {
    id: "synthetic-record",
    author_id: "someone-else",
    status: "submitted",
    version: 2,
    successor_id: null,
  } as unknown as import("../server/risk-core.js").RiskAssessmentRecord;
  const html = renderToStaticMarkup(
    createElement(RiskReviewActions, {
      site: common.site,
      user: {
        id: "reviewer",
        name: "Synthetic",
        email: "synthetic@example.test",
      },
      row,
      onAdopt: () => {},
      onDirtyChange: () => {},
      onBusyChange: () => {},
    }),
  );
  assert.match(html, /문서 기록 수락/);
  assert.match(
    html,
    /실제 위험을 허용하거나 작업 재개를 승인하는 행위가 아닙니다/,
  );
  assert.match(html, /보완 요청·새 작성 초안 생성/);
});
