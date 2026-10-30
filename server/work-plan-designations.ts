import { z } from 'zod';
import { date } from './validation.js';
import type { WorkPlanBody } from './work-plan-validation.js';
import type { WorkPlanSource } from './work-plan-sources.js';
import { HttpError } from './site-operations.js';
import { escapeHtml as h } from './print.js';
const text=(n:number)=>z.string().trim().max(n);
export const designationRecords=z.object({schemaVersion:z.literal(1),rows:z.array(z.object({kind:z.enum(['commander','signaler']),label:text(200),workerId:z.uuid().nullable(),scope:text(2000),task:text(2000),equipmentIds:z.array(z.uuid()).max(10).refine(v=>new Set(v).size===v.length),noEquipmentReason:text(1000),recordDate:date.nullable(),basis:text(2000)}).strict()).max(10)}).strict();
export type DesignationRecords=z.infer<typeof designationRecords>;
export function completeDesignations(v:DesignationRecords){return v.rows.length>0&&v.rows.every(r=>r.label&&r.workerId&&r.scope&&r.task&&r.recordDate&&r.basis&&(r.equipmentIds.length>0||r.noEquipmentReason))&&new Set(v.rows.map(r=>r.kind+'\0'+r.label)).size===v.rows.length;}
export function validateDesignationReferences(body:WorkPlanBody){for(const r of body.designationRecords?.rows||[]){if(r.workerId&&!body.duties.some(d=>d.workerId===r.workerId))throw new HttpError(409,'지정 기록 대상자를 계획의 선택 명부에서 다시 확인하세요.');if(r.equipmentIds.some(id=>!body.equipmentIds.includes(id)))throw new HttpError(409,'지정 기록의 장비를 계획 선택 장비에서 다시 확인하세요.');}}
export function validateDesignationSnapshot(body:WorkPlanBody){if(!body.designationRecords)return;const v=designationRecords.parse(body.designationRecords);if(!completeDesignations(v))throw new HttpError(409,'고정 지정 기록의 자체 문서 조건이 불완전합니다.');validateDesignationReferences(body);}
export function resetDesignations(body:WorkPlanBody):WorkPlanBody{return body.designationRecords?{...body,designationRecords:{schemaVersion:1,rows:body.designationRecords.rows.map(r=>({...r,workerId:null,recordDate:null,basis:''}))}}:body;}
export function printDesignations(v:DesignationRecords,source:WorkPlanSource|null){return `<section><h2>지휘자·신호수 관련 수기 지정 기록</h2><p>실제 선임·동의·신원·서명·자격·법적 적합성을 인증하지 않습니다. 역할 구분은 사용자 입력이며 원청/하청으로 자동 분류하지 않습니다.</p>${v.rows.map(r=>{const w=source?.facts.duties.find(d=>d.worker.id===r.workerId)?.worker;return `<article><h3>${r.kind==='commander'?'작업지휘 기록':'신호수 기록'} · ${h(r.label)}</h3><p>명부 ${h(w?`${w.name} / ${w.affiliation} (${w.kind})`:r.workerId||'미선택')} · ${h(r.workerId||'')} (로그인 계정과 별개)</p><p>업무범위: ${h(r.scope)}</p><p>대상 작업: ${h(r.task)}</p><p>장비 UUID: ${h(r.equipmentIds.join(', ')||'미지정')} · ${h(r.noEquipmentReason)}</p><p>기록일: ${h(r.recordDate||'미입력')} · 작성 근거: ${h(r.basis)}</p></article>`;}).join('')}</section>`;}
