import test from "node:test";
import assert from "node:assert/strict";
import { assertEvidenceRequestOutputSize, renderEvidenceRequest, requestTsvText, requestVisibleText, type EvidenceRequestRow, type EvidenceRequestView } from "../server/cost-evidence-request-text.js";
const row: EvidenceRequestRow = { id: "row", version: 1, hash: "a".repeat(64), spendDate: "2026-10-01", description: "물품", categoryLabel: "분류", status: "active", amount: "999999999999999.123456", reasons: ["no_link"], links: [] };
const view: EvidenceRequestView = { siteId: "site", periodId: "period", month: "2026-10", periodVersion: 1, periodStatus: "open", evidenceVersion: 0, fingerprint: "b".repeat(64), rows: [row] };
test("display TSV escapes delimiters/controls and uses visible non-formula text prefix", () => {
  for (const value of ['=1+1', '+1', '-2', '@x', '＝1', '\t=1\nnext\r', '"\t=1', '\u0000=1', '\u202e=1', ' leading', '\\u0009']) {
    const out = requestTsvText(value);
    assert.ok(out.startsWith("text: "));
    assert.doesNotMatch(out, /[\t\n\r"\p{Cc}\p{Cf}]/u);
  }
  assert.equal(requestVisibleText('a\tb\n'), 'a\\u0009b\\u000a');
  assert.notEqual(requestVisibleText('\t'), requestVisibleText('\\u0009'));
});
test("request draft preserves exact amount and fixed columns, rejects empty/duplicate/overflow", () => {
  const result = renderEvidenceRequest(view, [{ ...row, description: 'x\t=1\n"\u2028' }]);
  const lines = result.tsv.split('\n');
  assert.equal(lines.length, 2); assert.equal(lines[0].split('\t').length, 16);
  assert.equal(lines[1].split('\t').length, 16);
  assert.match(result.text, /999999999999999\.123456원/);
  assert.ok(result.tsv.includes('text: won: 999999999999999.123456'));
  assert.throws(() => renderEvidenceRequest(view, []));
  assert.throws(() => renderEvidenceRequest(view, [row, row]));
  assert.throws(() => renderEvidenceRequest(view, [{ ...row, description: '가'.repeat(100000) }]));
});

test("output byte bound accepts exact 256KiB and rejects next UTF-8 byte without truncation", () => {
 const text="가".repeat(87381); assertEvidenceRequestOutputSize(text,"x");
 assert.throws(() => assertEvidenceRequestOutputSize(text,"xx"));
 assert.throws(() => renderEvidenceRequest(view, Array.from({length:51},(_,i)=>({...row,id:String(i)}))));
});
