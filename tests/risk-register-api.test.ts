import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { methodFixture } from "./fixtures/risk-method-fixture.js";
import { emptyNarrativeQuestions } from "../server/risk-narrative-model.js";
test("register actual app filters four submitted methods and returns only current summary fields",async()=>{
 const f=await methodFixture();try{
  const a=randomUUID(),b=randomUUID(),criteria=[{name:"Three",method:"three_level",rationale:"Own",levels:[{id:a,label:"High",description:"Own high",criterionAcceptable:false},{id:b,label:"Middle",description:"Own middle",criterionAcceptable:true},{id:randomUUID(),label:"Low",description:"Own low",criterionAcceptable:true}]},
   {name:"Checklist",method:"checklist",rationale:"Own",items:[{id:a,prompt:"Own A",guidance:"Guide A"}]},
   {name:"Narrative",method:"narrative",rationale:"Own",questions:Object.fromEntries(Object.keys(emptyNarrativeQuestions()).map(k=>[k,{prompt:`Own ${k}`,guidance:"Guide"}]))}];
  for(const c of criteria){
   let r=await f.send("post","/risk-criteria",c);assert.equal(r.status,200);const cid=r.body.id;
   r=await f.send("post",`/risk-criteria/${cid}/confirm`,{version:1,reason:"Own",confirmHumanCriteria:true});assert.equal(r.status,200);
   const common=structuredClone(f.doc.body.hazards[0]) as unknown as Record<string,unknown>;delete common.likelihood;delete common.severity;
   const h={...common,id:randomUUID(),task:"Task %_ ' 한글",...(c.method==="three_level"?{levelId:a}:c.method==="checklist"?{checklistItemId:a,outcome:"noncompliant"}:{exposurePath:"노출 경로",additionalPlanDecision:"further_review"})};
   r=await f.send("post","/risk-assessments",{body:{...f.doc.body,method:c.method,date:"2026-11-01",hazards:[h]},criteriaId:cid});assert.equal(r.status,200);const id=r.body.id;
   r=await f.send("post",`/risk-assessments/${id}/submit`,{version:1,reason:"Own",confirmRecordOnly:true});assert.equal(r.status,200);
  }
  const base=f.base+"/risk-assessment-register";
  const before=f.db.prepare("SELECT * FROM risk_assessments ORDER BY id").all();
  for(const method of ["product","three_level","checklist","narrative"]){const r=await f.agent.get(base+`?method=${method}`);assert.equal(r.status,200);assert.equal(r.body.total,1);assert.equal(r.body.items[0].method,method);assert.equal(r.body.items[0].body,undefined);assert.equal(r.body.items[0].submission,undefined);assert.equal(r.body.items[0].decision,undefined);}
  let r=await f.agent.get(base+"?"+new URLSearchParams({dateFrom:"2026-11-01",dateTo:"2026-11-01",status:"submitted",keyword:"%_ ' 한글"}));assert.equal(r.status,200);assert.equal(r.body.total,3);
  r=await f.agent.get(base+"?status=accepted&lineage=leaf");assert.equal(r.body.total,1);assert.equal(r.body.items[0].id,f.doc.id);
  assert.deepEqual(f.db.prepare("SELECT * FROM risk_assessments ORDER BY id").all(),before);
  assert.equal((await f.agent.get(base+"?dateFrom=2026-11-01&dateTo=2026-10-28")).status,400);assert.equal((await f.agent.get(base+"?companyId="+randomUUID())).status,400);
 }finally{f.db.close();}
});
test("register actual correction/prior and independent reuse leaf, viewer and site authorization",async()=>{
 const f=await methodFixture();try{
  let r=await f.send("post",`/risk-assessments/${f.doc.id}/reuse`,{version:f.doc.version,submissionVersion:f.doc.submission.version,submissionHash:f.doc.submission_hash,hazardIds:[f.doc.body.hazards[0].id],includePlans:false,title:"Independent reuse",date:"2026-11-02",timing:"수시",trigger:"Own",workScope:"Own",reason:"Own",confirmHistoricalCriteria:true,confirmReset:true});assert.equal(r.status,200);const reused=r.body.id;
  r=await f.reviewSend(`/risk-assessments/${f.doc.id}/revise`,{version:f.doc.version,reason:"Own",authorId:f.manager});assert.equal(r.status,200);const child=r.body.nextDraft.id;
  const base=f.base+"/risk-assessment-register";
  r=await f.agent.get(base+"?lineage=prior");assert.equal(r.body.total,1);assert.equal(r.body.items[0].id,f.doc.id);assert.equal(r.body.items[0].successorId,child);
  r=await f.agent.get(base+"?lineage=leaf&status=draft");assert.equal(r.body.total,2);assert.deepEqual(new Set(r.body.items.map((x:{id:string})=>x.id)),new Set([reused,child]));
  f.db.prepare("UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?").run(f.site,f.manager);assert.equal((await f.agent.get(base)).status,200);
  const other=randomUUID();f.db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(other,"Other");assert.equal((await f.agent.get(`/api/sites/${other}/risk-assessment-register`)).status,403);
  f.db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(other,f.manager,"viewer");r=await f.agent.get(`/api/sites/${other}/risk-assessment-register`);assert.equal(r.status,200);assert.equal(r.body.total,0);
  f.db.prepare("DELETE FROM memberships WHERE site_id=? AND user_id=?").run(f.site,f.manager);assert.equal((await f.agent.get(base)).status,403);
 }finally{f.db.close();}
});
test("register actual51 documents supports offset count and deterministic pages while old picker stays compatible",async()=>{
 const f=await methodFixture();try{
  const rows:{id:string;created_at:string}[]=[];
  for(let i=0;i<51;i++){const r=await f.send("post","/risk-assessments",{body:{...f.doc.body,title:`needle51 ${i}`},criteriaId:f.doc.criteria_id});assert.equal(r.status,200);rows.push(r.body);}
  rows.sort((a,b)=>b.created_at.localeCompare(a.created_at)||a.id.localeCompare(b.id));
  const base=f.base+"/risk-assessment-register?keyword=needle51";
  const first=await f.agent.get(base),second=await f.agent.get(base+"&offset=50");assert.equal(first.status,200);assert.equal(second.status,200);assert.equal(first.body.total,51);assert.equal(first.body.hasMore,true);assert.equal(second.body.total,51);assert.equal(second.body.hasMore,false);
  assert.deepEqual(first.body.items.map((x:{id:string})=>x.id),rows.slice(0,50).map(x=>x.id));assert.deepEqual(second.body.items.map((x:{id:string})=>x.id),rows.slice(50).map(x=>x.id));
  const again=await f.agent.get(base);assert.deepEqual(again.body.items,first.body.items);
  const old=await f.agent.get(f.base+"/risk-assessments?method=product&offset=0");assert.equal(old.status,200);assert.equal(old.body.items.length,50);assert.ok(old.body.items[0].body);assert.equal(old.body.total,undefined);
  assert.equal((await f.agent.get(base+"&offset=-1")).status,400);assert.equal((await f.agent.get(base+"&offset=1000001")).status,400);
 }finally{f.db.close();}
});
