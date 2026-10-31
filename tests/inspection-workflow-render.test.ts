import test from "node:test";
import assert from "node:assert/strict";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {InspectionTasksPanel} from "../src/InspectionTasksPanel.js";
import {InspectionsPanel} from "../src/InspectionsPanel.js";
import {InspectionUseNotice} from "../src/InspectionUseNotice.js";
const site={id:"synthetic",name:"Synthetic",role:"manager" as const,version:1},user={id:"synthetic",name:"Synthetic",email:"synthetic@example.test"};
test("schedule register distinguishes comparison date/current state and personal scheduled work from all records",()=>{
 const html=renderToStaticMarkup(createElement(InspectionTasksPanel,{site,user,onClose:()=>{},onDirtyChange:()=>{},onBusyChange:()=>{}}));
 const from=new Date();from.setDate(from.getDate()-90);assert.ok(html.includes(`value="${from.toLocaleDateString("en-CA")}"`),"default start date keeps the register under the 1000-candidate cap");
 for(const text of ["과거 당시 상태 재현","직접 작성 점검은 전체 점검 기록","후보1000건 초과","100단계 초과는 판정보류","내 검토가능 (본인 제출 제외)"])assert.ok(html.includes(text));
 const records=renderToStaticMarkup(createElement(InspectionsPanel,{site,user,onDirtyChange:()=>{},onBusyChange:()=>{}}));assert.match(records,/점검 기록일 시작/);assert.match(records,/후속 없는 현재 기록/);assert.match(records,/직접작성\/일정기반 점검을 함께/);
});
test("template stop notice explicitly preserves already bound work and existing draft visibility",()=>{
 const html=renderToStaticMarkup(createElement(InspectionUseNotice,{state:{templateId:"synthetic",version:2,sourceHash:"a".repeat(64),stop:{templateId:"synthetic",siteId:"synthetic",version:2,sourceHash:"a".repeat(64),reason:"<script>Own</script>",actor:{id:"synthetic",name:"Synthetic"},at:"synthetic"},useStopped:true,successor:{id:"child",status:"draft",version:1}}}));
 assert.match(html,/중지는 해제할 수 없습니다/);assert.match(html,/이미 양식을 고정한 일정의 시작/);assert.match(html,/후속 양식 child · 초안/);assert.ok(!html.includes("<script>"));
});
