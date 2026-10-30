import {test} from "node:test";
import assert from "node:assert/strict";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {MinutesAttachments} from "../src/MinutesAttachments.js";
import type {Meeting} from "../src/api.js";
test('minutes attachment initial SSR explicitly describes retained detached visibility without inline originals',()=>{
 const html=renderToStaticMarkup(createElement(MinutesAttachments,{siteId:'s',record:{id:'m',version:1,status:'draft',parentId:'old'} as Meeting,editable:true,disabled:false,onBusy:()=>{},onDirty:()=>{},onRecord:()=>{}}));
 assert.ok(html.includes('현재 현장의 모든 읽기 계정이 다운로드'));assert.ok(html.includes('PNG/JPEG'));assert.ok(html.includes('UNSCANNED'));assert.ok(html.includes('신고/작업계획 첨부와 합산'));assert.ok(html.includes('이전 첨부를 자동 복사하지 않습니다'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('보존 첨부 없음'));
});
test('meeting PDF selector and warning never present an inline viewer or a validity claim',()=>{
 const html=renderToStaticMarkup(createElement(MinutesAttachments,{siteId:'s',record:{id:'m',version:1,status:'draft'} as Meeting,editable:true,disabled:false,onBusy:()=>{},onDirty:()=>{},onRecord:()=>{}}));
 assert.ok(html.includes('accept=".png,.jpg,.jpeg,.pdf"'));assert.ok(html.includes('헤더만 맞는 손상·위장 파일도 저장될 수 있습니다'));assert.ok(html.includes('PDF 구조·암호·스크립트'));assert.ok(html.includes('다운로드 후 여는 프로그램의 동작은 앱이 통제하지 않습니다'));assert.doesNotMatch(html,/<(?:iframe|embed|object|img)\b/);
 const reader=renderToStaticMarkup(createElement(MinutesAttachments,{siteId:'s',record:{id:'m',version:2,status:'finalized'} as Meeting,editable:false,disabled:false,onBusy:()=>{},onDirty:()=>{},onRecord:()=>{}}));assert.ok(!reader.includes('type="file"'));assert.ok(reader.includes('UNSCANNED'));
});
