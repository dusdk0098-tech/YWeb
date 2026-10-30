import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StockMinimumSummary } from "../src/StockMinimumSummary.js";
import { StockMinimumPanel } from "../src/StockMinimumPanel.js";
import { StockMinimumEditor } from "../src/StockMinimumEditor.js";
import type { MinimumDetail } from "../src/stock-minimum-types.js";
test("minimum UI distinguishes unavailable from zero and page counts from site shortage", () => {
 const row: MinimumDetail={item:{id:"test",name:"<자체>",unit:"개",version:1},configVersion:0,setting:null,status:"unavailable",balance:null,shortfall:null,movementCount:null,lastMovement:null,unavailableReason:"0 또는 부족 없음이 아닙니다.",queriedAt:"2026-10-28"};
 const summary=renderToStaticMarkup(createElement(StockMinimumSummary,{record:row}));
 assert.match(summary,/비교 불가/);assert.match(summary,/잔량 확인 불가/);assert.doesNotMatch(summary,/잔량 0/);
 const page=renderToStaticMarkup(createElement(StockMinimumPanel,{siteId:"x",onOpen:()=>{},onClose:()=>{},disabled:false}));
 assert.match(page,/이번 페이지뿐/);assert.match(page,/현장 전체 부족 합계가 아닙니다/);assert.match(page,/10개씩/);
 const editor=renderToStaticMarkup(createElement(StockMinimumEditor,{base:"x",onClose:()=>{},onDirtyChange:()=>{},onBusyChange:()=>{}}));
 assert.match(editor,/0 기준은 해제가 아닙니다/);assert.match(editor,/월별 과거 재현/);
});
