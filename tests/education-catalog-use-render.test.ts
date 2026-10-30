import test from "node:test";
import assert from "node:assert/strict";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {CatalogStopForm} from "../src/CatalogStopForm.js";
import {CatalogUseNotice} from "../src/CatalogUseNotice.js";
test("stop form requires explicit confirmation and notice separates immutable records from current restrictions",()=>{
 const form=renderToStaticMarkup(createElement(CatalogStopForm,{busy:false,onDirtyChange:()=>{},onStop:()=>{}}));assert.match(form,/이 버전에는 해제가 없습니다/);assert.match(form,/사유는 이 현장의 조회자에게 보입니다/);assert.match(form,/<button disabled=""/);
 const notice=renderToStaticMarkup(createElement(CatalogUseNotice,{state:{catalogId:"synthetic",version:2,sourceHash:"a".repeat(64),useStopped:true,stop:{catalogId:"synthetic",siteId:"synthetic",version:2,sourceHash:"a".repeat(64),reason:"<script>own reason</script>",actor:{id:"synthetic",name:"Synthetic"},at:"synthetic"},publishedSuccessor:{id:"synthetic-child",version:2,hash:"b".repeat(64)}}}));
 assert.match(notice,/과거 원문과 별도/);assert.match(notice,/자동으로 대체하지 않습니다/);assert.ok(!notice.includes("<script>"));
});
import {EducationCatalogPanel} from "../src/EducationCatalogPanel.js";
import {CatalogCurrentWarning} from "../src/CatalogCurrentWarning.js";
test("catalog register initial UI states literal search/current count and current warning loading is not an old snapshot",()=>{
 const panel=renderToStaticMarkup(createElement(EducationCatalogPanel,{site:{id:"synthetic",name:"Synthetic",role:"editor",version:1},onClose:()=>{},onJournal:()=>{},onDirtyChange:()=>{},onBusyChange:()=>{}}));
 assert.match(panel,/제목·자체 분류·본문 문자 검색/);assert.match(panel,/페이지 이동 사이에 자료가 바뀔/);assert.ok(!panel.includes('<option value="draft"'));
 const warning=renderToStaticMarkup(createElement(CatalogCurrentWarning,{path:"/sites/synthetic/education/synthetic",disabled:false}));assert.match(warning,/과거 보관본과 별도/);assert.ok(!warning.includes("중지 기록 없음"));
});
