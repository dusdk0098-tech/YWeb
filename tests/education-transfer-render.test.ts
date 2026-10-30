import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EducationContentTransfer } from "../src/EducationContentTransfer.js";
test('education transfer SSR states unpublished rights assertion and non-portable use-stop policy',()=>{
 const html=renderToStaticMarkup(createElement(EducationContentTransfer,{siteId:'s',onClose:()=>{},onDraft:()=>{},onDirtyChange:()=>{},onBusyChange:()=>{}}));
 assert.ok(html.includes('새 미게시 초안'));assert.ok(html.includes('사용중지 게시본도 읽기/내보내기는 가능합니다'));assert.ok(html.includes('권리 검증이나 법정 교육 인증이 아닙니다'));assert.ok(html.includes('120KiB'));assert.ok(!html.includes('권리 인증 완료'));
});
import { EducationCatalogPanel } from "../src/EducationCatalogPanel.js";
test('catalog transfer entry remains manager-only alongside existing current register filters',()=>{
 const props={site:{id:'s',name:'site',role:'manager' as const,version:1},onClose:()=>{},onJournal:()=>{},onDirtyChange:()=>{},onBusyChange:()=>{}};
 const manager=renderToStaticMarkup(createElement(EducationCatalogPanel,props)),viewer=renderToStaticMarkup(createElement(EducationCatalogPanel,{...props,site:{...props.site,role:'viewer'}}));
 assert.ok(manager.includes('자체 내용 JSON 가져오기 / 내보내기'));assert.ok(manager.includes('게시본 신규사용'));assert.ok(!viewer.includes('자체 내용 JSON 가져오기 / 내보내기'));assert.ok(viewer.includes('게시본 신규사용'));
});
