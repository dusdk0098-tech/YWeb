import {z} from 'zod';
import {HttpError} from './site-operations.js';
import type {MethodCriteria} from './risk-methods.js';
import {checklistHazardInput,checklistLabels} from './risk-checklist-model.js';
import {narrativeDecisionLabels} from './risk-narrative-labels.js';
const answer=z.string().trim().min(1).max(2000);
export const checklistResidualFields=z.object({method:z.literal('checklist'),checklistItemId:z.uuid(),outcome:z.enum(['compliant','noncompliant','not_applicable'])});
export const narrativeResidualFields=z.object({method:z.literal('narrative'),answers:z.object({scenario:answer,exposedGroup:z.string().trim().min(1).max(300),exposurePath:answer,harm:answer,currentControls:answer}).strict(),additionalPlanDecision:z.enum(['planned','none_proposed','further_review']),followupNotes:z.string().trim().max(5000)});
export type ChecklistResidualInput=z.infer<typeof checklistResidualFields>;
export type NarrativeResidualInput=z.infer<typeof narrativeResidualFields>;
export function nonnumericResidualValues(v:ChecklistResidualInput|NarrativeResidualInput,criteria:MethodCriteria,hazard:unknown){
 if(v.method==='checklist'){
  if(criteria.method!=='checklist')throw new HttpError(400,'체크리스트 원 기준에서만 항목 재평가를 입력하세요.');
  const source=checklistHazardInput.parse(hazard),item=criteria.items.find(i=>i.id===v.checklistItemId);
  if(!item||source.checklistItemId!==item.id)throw new HttpError(400,'원 위험행에 고정된 정확한 체크항목만 재평가하세요.');
  return {method:'checklist' as const,checklistItemId:item.id,outcome:v.outcome,result:{score:null,criterionAcceptable:null,selectionKind:'human_checklist' as const,checklistItemId:item.id,prompt:item.prompt,guidance:item.guidance,outcome:v.outcome,bandLabel:checklistLabels[v.outcome],judgmentUnresolved:v.outcome==='noncompliant'}};
 }
 if(criteria.method!=='narrative')throw new HttpError(400,'서술형 원 기준에서만 서술 재평가를 입력하세요.');
 if(v.additionalPlanDecision==='planned'&&!v.followupNotes)throw new HttpError(400,'추가조치 제안은 구체적인 제안 메모가 필요합니다. 실행계획/배정은 자동 생성하지 않습니다.');
 if(v.additionalPlanDecision==='none_proposed'&&v.followupNotes)throw new HttpError(400,'추가조치 미제안과 제안 메모를 동시에 기록하지 않습니다. 판단/메모를 확인하세요.');
 return {method:'narrative' as const,answers:v.answers,additionalPlanDecision:v.additionalPlanDecision,followupNotes:v.followupNotes,result:{score:null,criterionAcceptable:null,selectionKind:'human_narrative' as const,additionalPlanDecision:v.additionalPlanDecision,bandLabel:v.additionalPlanDecision==='planned'?'추가조치 제안 메모 있음 (미배정/미실행)':narrativeDecisionLabels[v.additionalPlanDecision],judgmentUnresolved:v.additionalPlanDecision==='further_review'}};
}
export type NonNumericResidualValues=ReturnType<typeof nonnumericResidualValues>;
