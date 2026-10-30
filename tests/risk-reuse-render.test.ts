import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RiskReuseForm } from "../src/RiskReuseForm.js";
import type { RiskAssessmentRecord } from "../server/risk-core.js";
test("reuse form states historical criteria, no decision copying and checklist incompleteness",()=>{
 const row={id:"synthetic",version:2,status:"submitted",submission_hash:"a".repeat(64),body:{method:"checklist"},submission:{version:2,criteria:{version:1,body:{name:"<own question>"}},body:{hazards:[{id:"h",task:"task",scenario:"old description"}]}}} as unknown as RiskAssessmentRecord;
 const html=renderToStaticMarkup(createElement(RiskReuseForm,{siteId:"site",source:row,onAdopt:()=>{},onDirtyChange:()=>{},onBusyChange:()=>{}}));
 assert.match(html,/정정\/후속 연결을 만들지 않습니다/);assert.match(html,/미응답 항목/);assert.match(html,/&lt;own question&gt;/);assert.match(html,/내 새 초안 생성/);assert.match(html,/당시 고정 기준/);
});
