import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CostInputPresets } from "../src/CostInputPresets.js";
import { CostSelectedExpense } from "../src/CostSelectedExpense.js";
test("preset SSR separates defaults from ledger write and unknown history from empty",()=>{
 const html=renderToStaticMarkup(createElement(CostInputPresets,{siteId:"synthetic",onClose:()=>{},onDirtyChange:()=>{},onBusyChange:()=>{}}));
 assert.match(html,/설명·수량·원 단가만/);assert.match(html,/선택은 원장 저장이 아닙니다/);assert.match(html,/목록 미조회/);assert.match(html,/사용 중지 포함/);assert.doesNotMatch(html,/type="date"/);
});
test("selected search row SSR shows exact id and pending lookup rather than pretend scroll/edit",()=>{
 const html=renderToStaticMarkup(createElement(CostSelectedExpense,{base:"/sites/s/cost-periods/p",selection:{id:"exact-expense",version:7,status:"cancelled"}}));
 assert.match(html,/exact-expense/);assert.match(html,/v7/);assert.match(html,/선택 행 조회 중/);assert.doesNotMatch(html,/스크롤 완료|저장 완료/);
});

test("explicit preset application creates blank date/category and preserves exact reference, not a ledger command",async()=>{
 const { costPresetDraft }=await import("../src/cost-preset-draft.js");
 const preset={body:{schema:1 as const,id:"preset",rootId:"preset",parentId:null,parentHash:null,version:2,status:"active" as const,name:"Synthetic",defaults:{description:"d",quantity:"1.5",unitPriceWon:"2"},reason:"r",actor:{id:"u",name:"u"},at:"t"},hash:"a".repeat(64),current:true,successorId:null};
 const result=costPresetDraft(preset);assert.equal(result.form.categoryId,"");assert.equal(result.form.spendDate,"");assert.deepEqual(result.source,{id:"preset",version:2,hash:preset.hash});assert.deepEqual(result.form,{categoryId:"",spendDate:"",description:"d",quantity:"1.5",unitPriceWon:"2"});
});

test("actual cost editor SSR exposes preset entry and exact selected-row card without auto edit",async()=>{
 const { openDatabase }=await import("../server/db.js"),{ getCostPeriod,costPeriodView }=await import("../server/cost-model.js"),{ CostPeriodEditor }=await import("../src/CostPeriodEditor.js");
 const db=openDatabase(":memory:");try {
  db.exec("INSERT INTO users VALUES('u','u@example.test','Synthetic','hash');INSERT INTO sites(id,name) VALUES('s','Site');");db.prepare("INSERT INTO cost_periods VALUES('p','s','2026-10',?,'Synthetic','open',1,NULL,NULL,NULL,'u','t','t')").run(JSON.stringify([{id:"c",label:"Category",plan:"10",opening:"0"}]));
  const period=costPeriodView(db,getCostPeriod(db,"s","p"));
  const html=renderToStaticMarkup(createElement(CostPeriodEditor,{site:{id:"s",name:"Site",version:1,role:"manager"},initial:period,initialExpenseSelection:{id:"exact-row",version:2,status:"cancelled"},onDirtyChange:()=>{},onBusyChange:()=>{},onClose:()=>{},onOpen:()=>{}}));
  assert.match(html,/반복 입력 프리셋 관리/);assert.match(html,/exact-row/);assert.match(html,/선택 행 조회 중/);assert.doesNotMatch(html,/<legend>지출 수정/);
 }finally{db.close();}
});
