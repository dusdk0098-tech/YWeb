import {test} from 'node:test';import assert from 'node:assert/strict';import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {WorkPlanAttachments} from '../src/WorkPlanAttachments.js';import {WorkPlanEditor} from '../src/WorkPlanEditor.js';import type {WorkPlan} from '../src/work-plan-types.js';import type {Site,User} from '../src/api.js';
test('plan originals SSR distinguishes own-author writes, retained site reads and no-copy corrections without a viewer',()=>{
 const record={id:'p',version:1,status:'draft',parent_id:'old'} as WorkPlan,props={siteId:'s',record,editable:true,disabled:false,onBusy:()=>{},onDirty:()=>{},onRecord:()=>{}};
 const html=renderToStaticMarkup(createElement(WorkPlanAttachments,props));assert.ok(html.includes('다른 관리자는 기존 기록 보관 권한이 있어도'));assert.ok(html.includes('반려/정정은 첨부 없는 새 초안'));assert.ok(html.includes('헤더만 맞는 손상·위장'));assert.ok(html.includes('신고/회의록 첨부와 합산'));assert.ok(html.includes('accept=".png,.jpg,.jpeg,.pdf"'));assert.doesNotMatch(html,/<(?:iframe|embed|object|img)\b/);
 const view=renderToStaticMarkup(createElement(WorkPlanAttachments,{...props,editable:false}));assert.ok(!view.includes('type="file"'));assert.ok(view.includes('현재 현장의 모든 읽기 계정이 다운로드'));
 const legacy=renderToStaticMarkup(createElement(WorkPlanAttachments,{...props,record:{...record,status:'archived',snapshot:null},editable:false}));assert.ok(legacy.includes('당시 첨부가 없었다고 새로 판정하지 않습니다'));
 const empty=renderToStaticMarkup(createElement(WorkPlanEditor,{site:{id:'s',role:'editor'} as Site,user:{id:'u'} as User,initial:null,onDirtyChange:()=>{},onBusyChange:()=>{},onClose:()=>{},onRevision:()=>{}}));assert.ok(empty.includes('원본 첨부는 초안을 먼저 저장'));
});
