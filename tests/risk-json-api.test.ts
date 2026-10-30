import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { methodFixture } from "./fixtures/risk-method-fixture.js";
import { emptyNarrativeQuestions } from "../server/risk-narrative-model.js";
import { riskHash } from "../server/risk-model.js";
import type { RiskAssessmentRecord } from "../server/risk-core.js";
const path=(id:string)=>`/risk-assessments/${id}`;
async function download(f:Awaited<ReturnType<typeof methodFixture>>,id:string){
 const c=await f.agent.get(f.base+path(id)+"/print-context");assert.equal(c.status,200,JSON.stringify(c.body));
 return f.agent.get(f.base+path(id)+`/export.json?expectedFingerprint=${c.body.fingerprint}`);
}
test("JSON actual app download preserves source/hash, headers and declared exclusions without business writes",async()=>{
 const f=await methodFixture();try{
  let r=await f.send("post",path(f.doc.id)+"/opinions",{submissionHash:f.doc.submission_hash,hazardId:f.doc.body.hazards[0].id,text:"PRIVATE_OPINION_MARKER",confirmAccountOpinion:true});assert.equal(r.status,200);
  r=await f.send("post","/risk-publications",{assessmentId:f.doc.id,assessmentVersion:f.doc.version,submissionHash:f.doc.submission_hash,recipientIds:[f.reviewer],statement:"PRIVATE_PUBLICATION_MARKER",reason:"Own",confirmAccountPublication:true});assert.equal(r.status,200);
  const p=(await f.agent.get(f.base+`/risk-publications/${r.body.id}`)).body;
  r=await f.reviewSend(`/risk-publications/${p.id}/acknowledge`,{version:p.version,publicationHash:p.publicationHash,submissionHash:p.publication.source.submissionHash,confirmOwnAccount:true});assert.equal(r.status,200);
  r=await f.reviewSend(path(f.doc.id)+"/actions",{version:f.doc.version,hazardId:f.doc.body.hazards[0].id,planIndex:0,assigneeId:f.manager,due:"2026-11-01",reason:"PRIVATE_ACTION_DETAIL_MARKER",confirmManualTracking:true});assert.equal(r.status,200);
  const tables=["risk_assessments","risk_events","risk_actions","risk_action_events","risk_opinions","risk_publications","risk_publication_acks"];
  const before=Object.fromEntries(tables.map(t=>[t,f.db.prepare(`SELECT * FROM ${t}`).all()]));
  r=await download(f,f.doc.id);assert.equal(r.status,200,JSON.stringify(r.body));
  assert.match(r.headers["content-type"],/^application\/json; charset=utf-8/);assert.equal(r.headers["cache-control"],"no-store");assert.equal(r.headers["content-disposition"],`attachment; filename="pedit-risk-${f.doc.id}-submission-v${f.doc.submission.version}.json"`);
  assert.equal(r.body.format,"pedit-risk-assessment");assert.equal(r.body.schemaVersion,1);assert.deepEqual(r.body.fixedSource.submission,f.doc.submission);assert.equal(riskHash(r.body.fixedSource.submission),f.doc.submission_hash);assert.equal(r.body.fixedSource.reuseProvenance,null);
  assert.equal(r.body.currentSummary.counts.actions,1);assert.equal(r.body.currentSummary.document.status,"accepted");
  for(const marker of ["PRIVATE_OPINION_MARKER","PRIVATE_PUBLICATION_MARKER","PRIVATE_ACTION_DETAIL_MARKER"])assert.equal(r.text.includes(marker),false);
  assert.equal(r.body.actions,undefined);assert.equal(r.body.currentSummary.actions,undefined);assert.equal(r.body.currentSummary.recipients,undefined);
  for(const t of tables)assert.deepEqual(f.db.prepare(`SELECT * FROM ${t}`).all(),before[t]);
 }finally{f.db.close();}
});
test("JSON real app four methods, Unicode and immutable reuse provenance roundtrip",async()=>{
 const f=await methodFixture();try{
  const a=randomUUID(),b=randomUUID();
  const criteria=[{name:"Three",method:"three_level",rationale:"Own",levels:[{id:a,label:"High",description:"Own high",criterionAcceptable:false},{id:b,label:"Middle",description:"Own middle",criterionAcceptable:true},{id:randomUUID(),label:"Low",description:"Own low",criterionAcceptable:true}]},
   {name:"Checklist",method:"checklist",rationale:"Own",items:[{id:a,prompt:"Own A",guidance:"Guide A"}]},
   {name:"Narrative",method:"narrative",rationale:"Own",questions:Object.fromEntries(Object.keys(emptyNarrativeQuestions()).map(k=>[k,{prompt:`Own ${k}`,guidance:"Guide"}]))}];
  for(const c of criteria){
   let r=await f.send("post","/risk-criteria",c);assert.equal(r.status,200);const cid=r.body.id;
   r=await f.send("post",`/risk-criteria/${cid}/confirm`,{version:1,reason:"Own",confirmHumanCriteria:true});assert.equal(r.status,200);
   const common=structuredClone(f.doc.body.hazards[0]) as unknown as Record<string,unknown>;delete common.likelihood;delete common.severity;
   const h={...common,id:randomUUID(),...(c.method==="three_level"?{levelId:a}:c.method==="checklist"?{checklistItemId:a,outcome:"noncompliant"}:{exposurePath:"노출 경로",additionalPlanDecision:"further_review"})};
   r=await f.send("post","/risk-assessments",{body:{...f.doc.body,title:"한글 <표제> =1+1",method:c.method,hazards:[h]},criteriaId:cid});assert.equal(r.status,200);const id=r.body.id;
   r=await f.send("post",path(id)+"/submit",{version:1,reason:"Own",confirmRecordOnly:true});assert.equal(r.status,200);const doc=r.body;
   r=await download(f,id);assert.equal(r.status,200);assert.deepEqual(r.body.fixedSource.submission,doc.submission);assert.equal(r.body.fixedSource.submission.body.title,"한글 <표제> =1+1");assert.equal(r.body.fixedSource.submission.body.method,c.method);
  }
  let r=await f.send("post",path(f.doc.id)+"/reuse",{version:f.doc.version,submissionVersion:f.doc.submission.version,submissionHash:f.doc.submission_hash,hazardIds:[f.doc.body.hazards[0].id],includePlans:true,title:"Reuse",date:"2026-10-28",timing:"수시",trigger:"Own",workScope:"Own",reason:"불변 출처 <reason>",confirmHistoricalCriteria:true,confirmReset:true});assert.equal(r.status,200);const next=r.body as RiskAssessmentRecord;
  const body={...next.body,hazards:[{...f.doc.body.hazards[0],id:next.body.hazards[0].id}]};
  r=await f.send("put",path(next.id),{version:1,body,reason:"Human re-entry"});assert.equal(r.status,200);
  r=await f.send("post",path(next.id)+"/submit",{version:2,reason:"Own",confirmRecordOnly:true});assert.equal(r.status,200);
  const expected=(await f.agent.get(f.base+path(next.id)+"/reuse-source")).body.source;
  r=await download(f,next.id);assert.equal(r.status,200);assert.deepEqual(r.body.fixedSource.reuseProvenance,expected);assert.equal(r.body.fixedSource.reuseProvenance.sourceSubmissionHash,f.doc.submission_hash);
 }finally{f.db.close();}
});
test("JSON actual app fingerprint, draft, query and site permissions fail closed",async()=>{
 const f=await methodFixture();try{
  const base=f.base+path(f.doc.id),pc=(await f.agent.get(base+"/print-context")).body,url=base+`/export.json?expectedFingerprint=${pc.fingerprint}`;
  assert.equal((await f.agent.get(base+"/export.json")).status,400);assert.equal((await f.agent.get(url+"&extra=1")).status,400);
  f.db.prepare("UPDATE sites SET name=? WHERE id=?").run("Changed current name",f.site);assert.equal((await f.agent.get(url)).status,409);
  const current=(await f.agent.get(base+"/print-context")).body;
  const r=await f.send("post","/risk-assessments",{body:f.doc.body,criteriaId:f.doc.criteria_id});assert.equal(r.status,200);
  assert.equal((await f.agent.get(f.base+path(r.body.id)+`/export.json?expectedFingerprint=${current.fingerprint}`)).status,409);
  const other=randomUUID();f.db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(other,"Other");f.db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(other,f.manager,"viewer");
  assert.equal((await f.agent.get(`/api/sites/${other}`+path(f.doc.id)+`/export.json?expectedFingerprint=${current.fingerprint}`)).status,404);
  f.db.prepare("UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?").run(f.site,f.manager);assert.equal((await download(f,f.doc.id)).status,200);
  f.db.prepare("DELETE FROM memberships WHERE site_id=? AND user_id=?").run(f.site,f.manager);assert.equal((await f.agent.get(url)).status,403);
 }finally{f.db.close();}
});
test("JSON route inherits bounded report read and rejects oversize without partial attachment",async()=>{
 const f=await methodFixture();try{
  const hazards=Array.from({length:50},()=>({...f.doc.body.hazards[0],id:randomUUID(),task:"t".repeat(2000),scenario:"s".repeat(2000),reference:"",likelihood:1,severity:1,plans:[]}));
  const body={...f.doc.body,hazards};let remaining=255000-Buffer.byteLength(JSON.stringify(body));
  for(const h of hazards){const count=Math.min(2000,remaining);h.reference="r".repeat(count);remaining-=count;}
  assert.equal(remaining,0);assert.equal(Buffer.byteLength(JSON.stringify(body)),255000);
  let r=await f.send("post","/risk-assessments",{body,criteriaId:f.doc.criteria_id});assert.equal(r.status,200,JSON.stringify(r.body));const id=r.body.id;
  r=await f.send("post",path(id)+"/submit",{version:1,reason:"Own",confirmRecordOnly:true});assert.equal(r.status,200);
  r=await f.agent.get(f.base+path(id)+`/export.json?expectedFingerprint=${"a".repeat(64)}`);assert.equal(r.status,400);assert.match(r.body.error,/256KiB/);assert.equal(r.headers["content-disposition"],undefined);assert.equal(r.body.fixedSource,undefined);
 }finally{f.db.close();}
});
