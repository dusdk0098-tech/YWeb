import test from "node:test";
import assert from "node:assert/strict";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {PpeReturnPolicy} from "../src/PpeReturnPolicy.js";
import {PpeReturnSummary} from "../src/PpeReturnSummary.js";
test("partial form explains lifetime count, immutable terminal and factual limits before confirmation",()=>{
 const html=renderToStaticMarkup(createElement(PpeReturnPolicy));
 for(const text of ["평생 최대 3회","취소한 기록도 횟수에 포함","효력일 순서","종결하면","실물 수령 증명이 아니며"])assert.ok(html.includes(text));

});

test("return summary renders exact terminal quantities, cancelled source and escaped record text",()=>{
 const html=renderToStaticMarkup(createElement(PpeReturnSummary,{unit:"ea",data:{summary:{returnedQuantity:"0.3",remainingQuantity:"0",partialCount:3,partialLimit:3,terminal:true},entries:[{id:"synthetic",issueId:"synthetic",sourceHash:"synthetic",movementId:"synthetic-movement",kind:"cancel",quantity:"0.1",cancelsId:"synthetic-partial",effectiveDate:"2026-10-28",reason:"<script>synthetic</script>",actor:{id:"synthetic",name:"Synthetic"},at:"synthetic"}]}}));
 assert.match(html,/반납 누계 0.3/);assert.match(html,/남은 수량 0/);assert.match(html,/종결 · 취소 불가/);assert.match(html,/취소대상 synthetic-partial/);assert.ok(!html.includes("<script>"));
});
