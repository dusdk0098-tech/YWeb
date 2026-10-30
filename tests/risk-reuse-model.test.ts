import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { reuseBody,reuseInput } from "../server/risk-reuse-model.js";
import { methodAssessmentInput } from "../server/risk-methods.js";
const id=randomUUID(), item=randomUUID();
const common={id,task:"합성 작업",location:"합성 위치",category:"",accidentType:"",scenario:"과거 상황",harm:"과거 피해",exposedGroup:"작업집단",reference:"",currentControls:"과거 조치",judgmentReason:"과거 판단",plans:[{action:"개선",controlType:"공학적",ownerNote:"과거 담당",due:"2026-01-01",priorityNote:"과거 우선",preconditions:"조건"}]};
const input=reuseInput.parse({version:2,submissionVersion:2,submissionHash:"a".repeat(64),hazardIds:[id],includePlans:true,title:"새 평가",date:"2026-10-28",timing:"수시",trigger:"새 계기",workScope:"새 범위",reason:"재사용",confirmHistoricalCriteria:true,confirmReset:true});
test("four methods reset judgments, issue new IDs and preserve source bytes",()=>{
 for(const [method,fields] of Object.entries({product:{likelihood:2,severity:3},three_level:{levelId:randomUUID()},checklist:{checklistItemId:item,outcome:"noncompliant"},narrative:{exposurePath:"과거 경로",additionalPlanDecision:"further_review"}})) {
  const body=methodAssessmentInput.parse({title:"원본",date:"2026-01-01",timing:"최초",trigger:"원",workScope:"원",method,hazards:[{...common,...fields}]});
  const bytes=JSON.stringify(body), result=reuseBody(body,input), h=result.body.hazards[0];
  assert.notEqual(h.id,id);assert.equal(result.mapping[0].sourceHazardId,id);assert.equal(h.judgmentReason,"");assert.equal(h.currentControls,"과거 조치");
  assert.equal(h.plans[0].due,null);assert.equal(h.plans[0].ownerNote,"");assert.equal(h.plans[0].priorityNote,"");assert.equal(h.plans[0].action,"개선");
  if(result.body.method === "product") assert.equal(result.body.hazards[0].likelihood,null);
  if(result.body.method === "three_level") assert.equal(result.body.hazards[0].levelId,null);
  if(result.body.method === "checklist") {assert.equal(result.body.hazards[0].outcome,null);assert.equal(result.body.hazards[0].checklistItemId,item);}
  if(result.body.method === "narrative") assert.equal(result.body.hazards[0].additionalPlanDecision,null);
  assert.equal(JSON.stringify(body),bytes);assert.equal(reuseBody(body,{...input,includePlans:false}).body.hazards[0].plans.length,0);
 }
});
test("strict request rejects duplicate, empty and unknown hazard selections",()=>{
 assert.equal(reuseInput.safeParse({...input,hazardIds:[]}).success,false);
 assert.equal(reuseInput.safeParse({...input,hazardIds:Array.from({length:50},()=>randomUUID())}).success,true);
 assert.equal(reuseInput.safeParse({...input,hazardIds:Array.from({length:51},()=>randomUUID())}).success,false);
 assert.equal(reuseInput.safeParse({...input,hazardIds:[id,id]}).success,false);
 assert.equal(reuseInput.safeParse({...input,authorId:randomUUID()}).success,false);
 const body=methodAssessmentInput.parse({title:"원본",date:"2026-01-01",timing:"최초",trigger:"",workScope:"",method:"product",hazards:[{...common,likelihood:2,severity:3}]});
 assert.throws(()=>reuseBody(body,{...input,hazardIds:[randomUUID()]}));
});
