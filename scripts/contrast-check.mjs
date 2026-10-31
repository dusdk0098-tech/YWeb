// Checks every text/background pair the tokens allow against WCAG 4.5:1 (3:1 for borders/large). No dependencies.
import console from "node:console";
import process from "node:process";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
const tokens = Object.fromEntries([...css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2].toLowerCase()]));
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// [text, background, minimum]
const pairs = [
  ["ink", "bg", 4.5], ["ink", "panel", 4.5], ["ink", "chrome", 4.5], ["ink", "well", 4.5],
  ["ink-muted", "bg", 4.5], ["ink-muted", "panel", 4.5], ["ink-muted", "chrome", 4.5],
  ["ink-on-primary", "primary", 4.5], ["ink-on-primary", "primary-hover", 4.5],
  ["primary", "panel", 4.5], ["primary", "bg", 4.5], ["primary-hover", "primary-soft", 4.5],
  ["signal-ink", "signal-soft", 4.5], ["signal-ink", "panel", 4.5],
  ["success", "panel", 4.5], ["success", "success-soft", 4.5],
  ["error", "panel", 4.5], ["error", "error-soft", 4.5],
  ["border", "panel", 3], ["border", "bg", 3], ["focus", "panel", 3], ["signal", "panel", 3],
];
let failed = 0;
for (const [fg, bg, min] of pairs) {
  const r = ratio(tokens[fg], tokens[bg]);
  const ok = r >= min;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${fg} on ${bg}: ${r.toFixed(2)} (min ${min})`);
}
if (failed) { console.error(`${failed} pair(s) below the minimum contrast`); process.exit(1); }
