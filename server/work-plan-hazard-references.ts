import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parseHazardReference,hazardReferenceCanonical,hazardReferenceKey,type HazardReference,type PlanHazardReferences } from './work-plan-hazard-reference-values.js';
import type { WorkPlanBody } from './work-plan-validation.js';
import type { Db } from './db.js';
import { HttpError } from './site-operations.js';
import { escapeHtml as h } from './print.js';
export function validHazardSource(v:unknown):v is HazardReference{try{const r=parseHazardReference(v);return createHash('sha256').update(hazardReferenceCanonical(r)).digest('hex')===r.contentHash;}catch{return false;}}
export const hazardReferences=z.object({schemaVersion:z.literal(1),rows:z.array(z.object({source:z.custom<HazardReference>(validHazardSource,'참고 원문/출처 hash 불일치'),applicationNote:z.string().trim().max(2000)}).strict()).max(20).refine(rows=>rows.every(r=>validHazardSource(r.source))&&new Set(rows.map(r=>hazardReferenceKey(r.source))).size===rows.length,'참고 출처 행 중복')}).strict();
export const completeHazardReferences=(v:PlanHazardReferences)=>v.rows.length>0&&v.rows.every(r=>!!r.applicationNote);
export function validateHazardReferenceChanges(db:Db,id:string,body:WorkPlanBody){if(!body.hazardReferences)return;const old=db.prepare('SELECT body FROM work_plans WHERE id=?').get(id) as {body:string}|undefined;if(!old)return;const previous=(JSON.parse(old.body) as WorkPlanBody).hazardReferences;for(const r of body.hazardReferences.rows){const found=previous?.rows.find(x=>hazardReferenceKey(x.source)===hazardReferenceKey(r.source));if(found&&found.source.contentHash!==r.source.contentHash)throw new HttpError(409,'같은 파일/시트/행의 원문을 덮어쓸 수 없습니다. 다른 출처 개정을 명시 선택하세요.');}}
export function validateHazardSnapshot(body:WorkPlanBody){if(body.hazardReferences){const v=hazardReferences.parse(body.hazardReferences);if(!completeHazardReferences(v))throw new HttpError(409,'고정 참고 적용 메모가 불완전합니다.');}}
export function resetHazardReferences(body:WorkPlanBody):WorkPlanBody{return body.hazardReferences?{...body,hazardReferences:{schemaVersion:1,rows:body.hazardReferences.rows.map(r=>({...r,applicationNote:''}))}}:body;}
export function printHazardReferences(v:PlanHazardReferences){return `<section><h2>사용자 제공 위험요인·대책 참고</h2><p>제공 원문과 사용자 적용 메모를 구분합니다. 현재 법정 기준·안전 승인·출처 진위/권리 인증 아님. 기존 대책/실행조치를 자동 변경하지 않습니다. 형식 버전은 법령 개정 버전이 아닙니다.</p>${v.rows.map(({source:s,applicationNote})=>`<article><h3>${h(s.section)} · ${h(s.category)}</h3><p>출처 원문 위험요인: ${h(s.hazard)}</p><p>출처 원문 대책: ${h(s.control)}</p><p>사용자 적용/확인 메모: ${h(applicationNote)}</p><p>파일 SHA-256 ${h(s.sourceFileSha256)} · 시트 ${h(s.sheet)} · 구간 ${h(s.sectionCell)} · 행 ${s.row} (A/B/E열) · 변환형식 ${s.formatVersion} · 항목 SHA-256 ${h(s.contentHash)}</p></article>`).join('')}</section>`;}
