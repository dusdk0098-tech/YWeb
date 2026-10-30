import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CostBaselines } from "../src/CostBaselines.js";
import type { CostPeriod } from "../server/cost-model.js";
import { printCostStatement } from "../server/cost-baseline-print.js";
test('cost baseline initial SSR does not claim delivered or no changes',()=>{
 const period={id:'p',status:'open',version:1} as CostPeriod;
 const html=renderToStaticMarkup(createElement(CostBaselines,{base:'/sites/s/cost-periods/p',period,onDirtyChange:()=>{}}));
 assert.ok(html.includes('수기 제출 진술'));assert.ok(html.includes('외부 전송·접수·열람이나'));assert.ok(html.includes('미마감 원장에서는 새 기준본을 만들지 않습니다'));assert.ok(!html.includes('조회한 범위에서 차이 없음'));
});
test('manual statement HTML escapes historical account and memo and keeps correction target',()=>{
 const html=printCostStatement({schema:1,id:'id',baselineId:'baseline',baselineHash:'a'.repeat(64),number:1,submittedDate:'2026-10-20',memo:'<script>end</script>',correctsId:'prior',actor:{id:'u',name:'<name>'},recordedAt:'2026-10-28T00:00:00Z',kind:'human-stated-submission'},'b'.repeat(64));
 assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;name&gt;'));assert.ok(html.includes('정정 대상 prior'));assert.ok(html.includes('기록 시각 2026-10-28T00:00:00Z'));
});
