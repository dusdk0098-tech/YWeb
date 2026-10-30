import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkPlanDocumentReview } from "../src/WorkPlanDocumentReview.js";
import { printWorkPlan } from "../server/work-plan-print.js";
import type { WorkPlan } from "../src/work-plan-types.js";
const body={title:"Synthetic <plan>",date:"2026-10-28",startTime:"09:00",endTime:"10:00",location:"Synthetic",workDescription:"Synthetic",emergencyProcedure:"Synthetic",verificationNote:"Synthetic",steps:[{task:"Task",procedure:"Procedure",precaution:"Precaution"}],equipmentIds:[],duties:[]};
test("work-plan review initial SSR preserves documentary limits and explicit actions only",()=>{
 const record:WorkPlan={id:"id",site_id:"site",body,status:"draft",version:1,author_id:"user",parent_id:null,revision_reason:"",source_capture:null,created_at:"now",updated_at:"now",snapshot:null,successorId:null,documentReview:{kind:"draft",review:null,referenceState:null}};
 const noop=()=>{},html=renderToStaticMarkup(createElement(WorkPlanDocumentReview,{site:{id:"site",name:"Synthetic",role:"manager",version:1},user:{id:"user",name:"Synthetic",email:"synthetic@example.test"},record,disabled:false,onSaved:noop,onRevision:noop,onDirtyChange:noop,onBusyChange:noop}));
 assert.match(html,/문서 제출·검토/);assert.match(html,/공학 검토·작업허가·안전 승인/);assert.match(html,/작성자가 문서 제출/);assert.doesNotMatch(html,/synthetic@example.test/);
});
test("submission print labels are explicit and 20-step final text is not truncated",()=>{
 const snapshot={id:"id",version:3,site:{id:"site",name:"Synthetic"},author:{id:"user",name:"Synthetic"},body:{...body,steps:Array.from({length:20},(_,i)=>({task:`Task ${i}`,procedure:"문".repeat(1490)+"<LAST>",precaution:"Human precaution"}))},source:{facts:{siteId:"site",equipment:[],duties:[]},fingerprint:"a".repeat(64),capturedAt:"now"},parentId:null,revisionReason:"",archivedBy:{id:"user",name:"Synthetic"},archivedAt:"now"};
 const legacy=printWorkPlan(snapshot,"a".repeat(64)),submitted=printWorkPlan({...snapshot,recordKind:"author_submission"},"b".repeat(64));assert.match(legacy,/관리자 기록 보관본/);assert.match(submitted,/작성자 제출본/);assert.match(submitted,/제출계정/);assert.match(submitted,/Task 19/);assert.equal((submitted.match(/&lt;LAST&gt;/g)||[]).length,20);assert.doesNotMatch(submitted,/<LAST>/);
});
