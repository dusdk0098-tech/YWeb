import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PpeCreate } from "../src/PpeCreate.js";
import { CompaniesPanel } from "../src/CompaniesPanel.js";
import type { Site } from "../src/api.js";
const site: Site = {
  id: "synthetic",
  name: "Synthetic",
  role: "manager",
  version: 1,
};
const noop = () => {};
test("PPE initial markup states full return only and requires quantity-effect confirmation", () => {
  const html = renderToStaticMarkup(
    createElement(PpeCreate, {
      site,
      onSaved: noop,
      onClose: noop,
      onDirtyChange: noop,
      onBusyChange: noop,
    }),
  );
  assert.match(html, /부분 반납/);
  assert.match(html, /수량·단위·재고 감소/);
  assert.match(html, /type="checkbox" required=""/);
  assert.match(html, /수령 서명이 아닙니다/);
});
test("company reader initial markup omits manager registration form", () => {
  const html = renderToStaticMarkup(
    createElement(CompaniesPanel, {
      site: { ...site, role: "viewer" },
      onDirtyChange: noop,
      onBusyChange: noop,
    }),
  );
  assert.doesNotMatch(html, /<form|업체 변경 기록/);
  assert.match(html, /별도 UUID/);
});
