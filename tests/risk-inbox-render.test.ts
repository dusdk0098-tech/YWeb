import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RiskInboxRows, RiskInboxPanel } from "../src/RiskInboxPanel.js";
import type { RiskInbox } from "../server/risk-inbox.js";
test("personal risk rows distinguish stopped source and lack of current report permission",()=>{
 const page:RiskInbox={siteId:"site",retrievedAt:"2026-10-28T12:00:00Z",kind:"actions",offset:0,hasMore:false,
 counts:{ownAssigned:1,ownReportAllowed:0,ownPublicationAllowed:0,ownPublicationStopped:1,reviewEligible:null},
 items:[{kind:"actions",id:"action",title:"<script>synthetic</script>",assessmentId:"doc",submissionVersion:2,submissionHash:"a".repeat(64),sourceHasSuccessor:true,actionable:false,stopReason:"current_role_cannot_report",due:"2026-11-01"},{kind:"publications",id:"pub",title:"Synthetic publication",assessmentId:"doc",submissionVersion:2,submissionHash:"a".repeat(64),sourceHasSuccessor:true,actionable:false,stopReason:"source_not_current"}]};
 const html=renderToStaticMarkup(createElement(RiskInboxRows,{page,onOpen:()=>{},disabled:false}));
 assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/현장 전체 현황이 아닙니다/);assert.match(html,/현재 역할은 보고할 수 없습니다/);assert.match(html,/미이행 업무로 세지 않습니다/);assert.doesNotMatch(html,/내가 검토 가능한 문서/);
});

test("personal inbox initial SSR is site-scoped manual refresh with role-specific review navigation",()=>{
 const base={user:{id:"user",name:"Synthetic account",email:"synthetic@example.test"},onClose:()=>{},onDirtyChange:()=>{},onBusyChange:()=>{}};
 for(const role of ["manager","viewer"] as const){
  const html=renderToStaticMarkup(createElement(RiskInboxPanel,{...base,site:{id:"site",name:"Synthetic <site>",role,version:1}}));
  assert.match(html,/Synthetic &lt;site&gt; · 내 위험성평가 업무/);assert.match(html,/내 업무 다시 조회/);assert.match(html,/알림 발송·전달·열람 추적을 하지 않으며/);
  assert.equal(html.includes("내가 검토 가능한 문서"),role==="manager");
  assert.doesNotMatch(html,/synthetic@example.test/);
 }
});
