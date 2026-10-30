import { riskNames, planFormName, type PlanForm, type PlanMeasurement, type PlanResponse } from "./work-plan-form-values.js";
export { blankPlanForm, blankCargo, riskNames, planFormName } from "./work-plan-form-values.js";
export type { PlanForm, PlanMeasurement, PlanResponse, PlanCargo } from "./work-plan-form-values.js";
import { z } from 'zod';
import { escapeHtml as h } from './print.js';
const text=(max:number)=>z.string().trim().max(max);
// Exact decimal text, no Number coercion, exponent, rounding or engineering calculation.
export const planMeasurement=z.object({value:z.string().regex(/^(0|[1-9]\d{0,6})(\.\d{1,6})?$/).refine(v=>{if(!/^(0|[1-9]\d{0,6})(\.\d{1,6})?$/.test(v))return false;const [a,b='']=v.split('.');return BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'))<=1000000000000n;},'입력 상한1,000,000 이하').nullable(),unit:z.enum(['','m','mm','t']),basis:text(1000)}).strict().refine(v=>v.value===null||v.unit!=='','값을 입력하면 단위도 명시하세요.');
const response=z.object({state:z.enum(['provided','not_applicable']).nullable(),note:text(2000)}).strict();
const common={schemaVersion:z.literal(1),terrain:response,groundwater:response,route:response,measures:z.object({fall:response,fallingObject:response,overturn:response,caught:response,collapse:response,other:response}).strict()};
const weight=planMeasurement.refine(v=>v.unit===''||v.unit==='t','중량 단위는 t로 명시하세요.');
const length=planMeasurement.refine(v=>v.unit===''||v.unit==='m'||v.unit==='mm','길이 단위는 m 또는 mm로 명시하세요.');
export const planCargo=z.object({description:text(500),length,height:length,width:length,unitMass:weight,otherMass:weight}).strict();
export const workPlanForm=z.discriminatedUnion('kind',[
 z.object({...common,kind:z.literal('general_machine'),equipmentMass:weight}).strict(),
 z.object({...common,kind:z.literal('excavator_lift'),radius:length,liftHeight:length,ratedLoad:weight,cargo:z.array(planCargo).max(6)}).strict(),
]);
const completedMeasurement=(v:PlanMeasurement)=>v.value!==null&&v.unit!==''&&!!v.basis;
export function completePlanForm(form:PlanForm){
 const answers=[form.terrain,form.groundwater,form.route,...Object.values(form.measures)];
 if(!answers.every(v=>v.state!==null&&!!v.note))return false;
 if(form.kind==='general_machine')return completedMeasurement(form.equipmentMass);
 return [form.radius,form.liftHeight,form.ratedLoad].every(completedMeasurement)&&form.cargo.length>0&&form.cargo.every(c=>!!c.description&&[c.length,c.height,c.width,c.unitMass,c.otherMass].every(completedMeasurement));
}
export function printPlanForm(form:PlanForm){
 const answer=(name:string,v:PlanResponse)=>`<article><h3>${h(name)}</h3><p>${v.state===null?'미입력':v.state==='provided'?'작성한 대책/설명':'사람이 해당 없음으로 기록 (사유 확인)'}</p><p>${h(v.note)}</p></article>`;
 const measure=(name:string,v:PlanMeasurement)=>`<p>${h(name)}: ${v.value===null?'미입력':h(v.value)} ${h(v.unit||'단위 미입력')} · 근거 ${h(v.basis||'미입력')}</p>`;
 return `<section><h2>${h(planFormName(form))} · 형식v${form.schemaVersion}</h2><p>자체 문서 완결 조건입니다. 법정 필수조건/작업허가/공학계산/안전 승인/서명이 아닙니다. 숫자는 사람의 수기 입력이며0과 미입력을 구분합니다. 단위 변환·중량 합산·안전하중 계산은 제공하지 않습니다. 원본 페이지와 동등하지 않습니다.</p>${answer('지형·지반',form.terrain)}${answer('지하수 상태',form.groundwater)}${answer('운행경로 설명 (그림 아님)',form.route)}${Object.entries(riskNames).map(([k,v])=>answer(v+' 위험 대책',form.measures[k as keyof typeof riskNames])).join('')}${form.kind==='general_machine'?measure('장비총중량',form.equipmentMass):measure('작업반경',form.radius)+measure('인양높이',form.liftHeight)+measure('매뉴얼 정격하중',form.ratedLoad)+form.cargo.map((c,i)=>`<article><h3>화물${i+1} · ${h(c.description)}</h3>${measure('길이 L',c.length)}${measure('높이 H',c.height)}${measure('폭 W',c.width)}${measure('단위화물중량',c.unitMass)}${measure('기타중량',c.otherMass)}</article>`).join('')}</section>`;
}
