import test from "node:test";
import assert from "node:assert/strict";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {CostStockReceiptForm} from "../src/CostStockReceiptForm.js";
import type {CostExpense} from "../src/cost-types.js";
import type {StockItem} from "../src/stock-types.js";
test("receipt form keeps physical quantity blank and distinguishes cost numeric quantity from units",()=>{
 const expense={id:"synthetic",version:1,description:"Own purchase",quantity:"99",amount:"198"} as CostExpense,item={id:"item",version:1,name:"Own item",unit:"개",balance:"0"} as StockItem;
 const html=renderToStaticMarkup(createElement(CostStockReceiptForm,{siteId:"site",periodId:"period",periodVersion:1,expense,item,onSaved:()=>{},onDirtyChange:()=>{},onBusyChange:()=>{}}));
 assert.match(html,/금액 계산 수량 99/);assert.match(html,/단위 없음/);assert.match(html,/실제 입고수량/);assert.match(html,/구매 lot\/수령 서명을 증명하지 않습니다/);assert.doesNotMatch(html,/value="99"/);
});
test("cost-stock integration initial panel and contextual PPE remain explicit separate operations",async()=>{
 const {CostStockPanel}=await import("../src/CostStockPanel.js"),{PpeCreate}=await import("../src/PpeCreate.js"),{StockCostSource}=await import("../src/StockCostSource.js");
 const common={site:{id:"synthetic",name:"Synthetic",role:"manager" as const,version:1},onClose:()=>{},onDirtyChange:()=>{},onBusyChange:()=>{}};
 const panel=renderToStaticMarkup(createElement(CostStockPanel,{...common,periodId:"period",expenseId:"expense"}));assert.match(panel,/비용 취소는 재고를 바꾸지 않습니다/);assert.match(panel,/구매 lot/);
 const ppe=renderToStaticMarkup(createElement(PpeCreate,{...common,initialItemId:"item",onSaved:()=>{}}));assert.doesNotMatch(ppe,/value="99"/);
 const source=renderToStaticMarkup(createElement(StockCostSource,{siteId:"site",receiptId:"receipt",disabled:false}));assert.match(source,/당시 비용 출처 \/ 현재 차이 조회/);assert.match(source,/비용은 자동 취소되지 않습니다/);
});
