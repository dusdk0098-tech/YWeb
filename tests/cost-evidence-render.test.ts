import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CostEvidence } from "../src/CostEvidence.js";
import { CostEvidenceWarnings } from "../src/CostEvidenceWarnings.js";
import { printCostEvidence } from "../server/cost-evidence-print.js";
import type { CostEvidence as Evidence } from "../src/cost-evidence-types.js";
test("cost evidence SSR and missing historical manifest never imply proof or empty originals",()=>{
 const html=renderToStaticMarkup(createElement(CostEvidence,{base:"/sites/s/cost-periods/p",onClose:()=>{},onDirtyChange:()=>{},onBusyChange:()=>{}}));
 assert.match(html,/월별 보존20파일/);assert.match(html,/파일별 활성 연결50행/);assert.match(html,/신고·회의록·작업계획·비용·교육 합산/);assert.match(html,/적격 검사/);assert.doesNotMatch(html,/<(?:img|iframe|object|embed)\b/);
 const view={warnings:{activeExpensesWithoutLink:["<unlinked>"],changedLinks:[{}],cancelledLinks:[{}],unlinkedFiles:["x"]}} as unknown as Evidence;
 const warnings=renderToStaticMarkup(createElement(CostEvidenceWarnings,{evidence:view}));assert.match(warnings,/&lt;unlinked&gt;/);assert.match(warnings,/자동 옮기거나 재확인하지 않습니다/);
 const old=printCostEvidence({recorded:false,closureId:"<old>",closureHash:"hash"});assert.match(old,/기록되지 않았습니다/);assert.match(old,/빈 목록으로 추정하지 않습니다/);assert.match(old,/&lt;old&gt;/);
});
