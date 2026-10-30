import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RiskPublicationView } from "../src/RiskPublicationView.js";
import { RiskPublicationsPanel } from "../src/RiskPublicationsPanel.js";
import type { PublicationView } from "../server/risk-publication-model.js";
const noop = () => {};
test("risk publication initial recipient view states exact scope and does not show manager target roster", () => {
  const p: PublicationView = { id: "p", siteId: "s", status: "published", version: 1, publicationHash: "a".repeat(64), publication: { id: "p", siteId: "s", source: { assessmentId: "doc", assessmentVersion: 3, submissionVersion: 2, submissionHash: "b".repeat(64), title: "Synthetic <script>" }, statement: "My account only", publisher: { id: "pub", name: "Publisher" }, publishedAt: "synthetic" }, ownAck: null, isTarget: true, canAcknowledge: false, sourceHasSuccessor: true, sourceStatus: "accepted", withdrawnAt: null, withdrawReason: null };
  const html = renderToStaticMarkup(createElement(RiskPublicationView, { site: { id: "s", name: "S", role: "viewer", version: 1 }, initial: p, onClose: noop, onDirtyChange: noop, onBusyChange: noop }));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /후속 평가 문서가 있어 이 게시본의 새 확인은 중지/);
  assert.match(html, /서명·안전 허가를 증명하지 않습니다/);
  assert.match(html, /내 계정으로 이 게시본 확인/);
  assert.match(html, /<fieldset disabled=""/);
  assert.doesNotMatch(html, /게시 당시 대상과 계정 확인 기록|철회 사유/);
});
test("risk publication list initial UI distinguishes account confirmation from signature and external delivery", () => {
  const html = renderToStaticMarkup(createElement(RiskPublicationsPanel, { site: { id: "s", name: "S", role: "viewer", version: 1 }, onClose: noop, onDirtyChange: noop, onBusyChange: noop }));
  assert.match(html, /내 계정 대상 위험성평가 게시본/);
  assert.match(html, /외부 발송\/열람 추적을 하지 않습니다/);
  assert.doesNotMatch(html, /게시할 수락 평가 선택/);
});
