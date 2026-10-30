import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RiskOpinionsPanel } from "../src/RiskOpinionsPanel.js";
test("account opinion queue labels account scope and viewer has no create action", () => {
  const html = renderToStaticMarkup(
    createElement(RiskOpinionsPanel, {
      site: { id: "synthetic", name: "Synthetic", role: "viewer", version: 1 },
      user: {
        id: "synthetic",
        name: "Synthetic",
        email: "synthetic@example.test",
      },
      onClose: () => {},
      onDirtyChange: () => {},
      onBusyChange: () => {},
    }),
  );
  assert.match(html, /계정 의견/);
  assert.match(html, /근로자/);
  assert.doesNotMatch(html, /<textarea/);
});
