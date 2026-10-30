import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { methodFixture } from "./fixtures/risk-method-fixture.js";
import type { RiskAssessmentRecord } from "../server/risk-core.js";
import { emptyNarrativeQuestions } from "../server/risk-narrative-model.js";
const input=(doc:RiskAssessmentRecord)=>({version:doc.version,submissionVersion:doc.submission!.version,submissionHash:doc.submission_hash,hazardIds:[doc.body.hazards[0].id],includePlans:true,title:"Synthetic reused <draft>",date:"2026-10-28",timing:"수시",trigger:"New trigger",workScope:"New scope",reason:"Own <reuse> reason",confirmHistoricalCriteria:true,confirmReset:true});
const related=["risk_actions","risk_residuals","risk_opinions","risk_publications","risk_publication_acks"];
test("reuse real app preserves original and correction chain, creates independent draft and idempotent immutable provenance",async()=>{
 const f=await methodFixture();try{
  let seeded=await f.send("post","/risk-publications",{assessmentId:f.doc.id,assessmentVersion:f.doc.version,submissionHash:f.doc.submission_hash,recipientIds:[f.reviewer],statement:"Synthetic account statement",reason:"Synthetic publication",confirmAccountPublication:true});
  assert.equal(seeded.status,200);const publication=(await f.agent.get(f.base+`/risk-publications/${seeded.body.id}`)).body;
  seeded=await f.reviewSend(`/risk-publications/${publication.id}/acknowledge`,{version:publication.version,publicationHash:publication.publicationHash,submissionHash:publication.publication.source.submissionHash,confirmOwnAccount:true});assert.equal(seeded.status,200,JSON.stringify(seeded.body));
  seeded=await f.reviewSend(`/risk-assessments/${f.doc.id}/actions`,{version:f.doc.version,hazardId:f.doc.body.hazards[0].id,planIndex:0,assigneeId:f.manager,due:"2026-11-01",reason:"Synthetic source action",confirmManualTracking:true});assert.equal(seeded.status,200);
  const before=f.db.prepare("SELECT * FROM risk_assessments WHERE id=?").get(f.doc.id);
  const tables=Object.fromEntries(related.map(t=>[t,f.db.prepare(`SELECT * FROM ${t}`).all()]));
  const v=input(f.doc),path=`/risk-assessments/${f.doc.id}/reuse`,key=randomUUID();
  let r=await f.send("post",path,v,key);assert.equal(r.status,200,JSON.stringify(r.body));const next=r.body;
  assert.equal(next.status,"draft");assert.equal(next.author_id,f.manager);assert.equal(next.version,1);assert.equal(next.parent_id,null);assert.equal(next.successor_id,null);assert.equal(next.submission,null);assert.equal(next.decision,null);
  assert.equal(next.body.hazards[0].likelihood,null);assert.equal(next.body.hazards[0].plans[0].due,null);
  assert.deepEqual((await f.send("post",path,v,key)).body,next);
  assert.equal((await f.send("post",path,{...v,title:"Different"},key)).status,409);
  const otherAuthor=await f.reviewSend(path,v);assert.equal(otherAuthor.status,200);assert.equal(otherAuthor.body.author_id,f.reviewer);
  const second=await f.send("post",path,v);assert.equal(second.status,200);assert.notEqual(second.body.id,next.id);
  assert.deepEqual(f.db.prepare("SELECT * FROM risk_assessments WHERE id=?").get(f.doc.id),before);
  for(const t of related)assert.deepEqual(f.db.prepare(`SELECT * FROM ${t}`).all(),tables[t]);
  r=await f.agent.get(f.base+`/risk-assessments/${next.id}/reuse-source`);assert.equal(r.status,200);assert.equal(r.body.source.sourceSubmissionHash,f.doc.submission_hash);assert.equal(r.body.source.mapping[0].newHazardId,next.body.hazards[0].id);
  assert.throws(()=>f.db.prepare("UPDATE risk_reuse_sources SET source_id=? WHERE assessment_id=?").run(next.id,next.id));
  assert.throws(()=>f.db.prepare("DELETE FROM risk_reuse_sources WHERE assessment_id=?").run(next.id));
  assert.equal((await f.send("post",`/risk-assessments/${next.id}/submit`,{version:1,reason:"Not re-evaluated",confirmRecordOnly:true})).status,400);
  const body=structuredClone(next.body);body.hazards[0]={...f.doc.body.hazards[0],id:next.body.hazards[0].id};
  r=await f.send("put",`/risk-assessments/${next.id}`,{version:1,body,reason:"Human review and entry"});assert.equal(r.status,200);
  r=await f.send("post",`/risk-assessments/${next.id}/submit`,{version:2,reason:"New human submission",confirmRecordOnly:true});assert.equal(r.status,200);
  const pc=(await f.agent.get(f.base+`/risk-assessments/${next.id}/print-context`)).body;
  r=await f.agent.get(f.base+`/risk-assessments/${next.id}/print?expectedFingerprint=${pc.fingerprint}`);assert.equal(r.status,200);assert.match(r.text,/독립 재사용 출처/);assert.match(r.text,/Own &lt;reuse&gt; reason/);assert.match(r.text,new RegExp(f.doc.submission_hash!));
  r=await f.reviewSend(`/risk-assessments/${f.doc.id}/revise`,{version:f.doc.version,reason:"Independent correction",authorId:f.manager});assert.equal(r.status,200);const corrected=r.body.nextDraft;
  const current=(await f.agent.get(f.base+`/risk-assessments/${f.doc.id}`)).body;
  const sourceBefore=f.db.prepare("SELECT * FROM risk_assessments WHERE id=?").get(f.doc.id);
  r=await f.send("post",path,input(current));assert.equal(r.status,200);assert.equal(r.body.parent_id,null);
  assert.deepEqual(f.db.prepare("SELECT * FROM risk_assessments WHERE id=?").get(f.doc.id),sourceBefore);
  assert.equal(current.successor_id,corrected.id);
 }finally{f.db.close();}
});
test("reuse real app rejects stale, draft, foreign hazard and permissions; audit failure rolls back",async()=>{
 const f=await methodFixture();try{
  const path=`/risk-assessments/${f.doc.id}/reuse`,v=input(f.doc);
  assert.equal((await f.send("post",path,{...v,version:1})).status,409);
  assert.equal((await f.send("post",path,{...v,submissionHash:"0".repeat(64)})).status,409);
  assert.equal((await f.send("post",path,{...v,hazardIds:[randomUUID()]})).status,400);
  assert.equal((await f.send("post",path,{...v,hazardIds:[v.hazardIds[0],v.hazardIds[0]]})).status,400);
  const before=f.db.prepare("SELECT COUNT(*) n FROM risk_assessments").get();
  f.db.exec("CREATE TRIGGER fail_reuse_event BEFORE INSERT ON risk_events WHEN NEW.event='reused_created' BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END;");
  assert.equal((await f.send("post",path,v)).status,500);assert.deepEqual(f.db.prepare("SELECT COUNT(*) n FROM risk_assessments").get(),before);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM risk_reuse_sources").get()?.n,0);f.db.exec("DROP TRIGGER fail_reuse_event");
  const next=(await f.send("post",path,v)).body;assert.equal((await f.send("post",`/risk-assessments/${next.id}/reuse`,{...v,version:1})).status,409);
  f.db.prepare("UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?").run(f.site,f.manager);assert.equal((await f.send("post",path,v)).status,403);
  const other=randomUUID();f.db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(other,"Other synthetic");
  f.db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(other,f.manager,"manager");
  assert.equal((await f.agent.get(`/api/sites/${other}/risk-assessments/${next.id}/reuse-source`)).status,404);
  f.db.prepare("DELETE FROM memberships WHERE site_id=? AND user_id=?").run(f.site,f.manager);assert.equal((await f.agent.get(f.base+`/risk-assessments/${next.id}/reuse-source`)).status,403);
 }finally{f.db.close();}
});
test("three-level checklist and narrative reuse preserve fixed criteria without copying judgments",async()=>{
 const f=await methodFixture();try{
  const a=randomUUID(),b=randomUUID();
  const criteria=[{name:"Three",method:"three_level",rationale:"Own",levels:[{id:a,label:"High",description:"Own high",criterionAcceptable:false},{id:b,label:"Middle",description:"Own middle",criterionAcceptable:true},{id:randomUUID(),label:"Low",description:"Own low",criterionAcceptable:true}]},
    {name:"Checklist",method:"checklist",rationale:"Own",items:[{id:a,prompt:"Own A",guidance:"Guide A"},{id:b,prompt:"Own B",guidance:"Guide B"}]},
    {name:"Narrative",method:"narrative",rationale:"Own",questions:Object.fromEntries(Object.keys(emptyNarrativeQuestions()).map(k=>[k,{prompt:`Own ${k}`,guidance:"Guide"}]))}];
  for(const c of criteria){
   let r=await f.send("post","/risk-criteria",c);assert.equal(r.status,200,JSON.stringify(r.body));const cid=r.body.id;
   r=await f.send("post",`/risk-criteria/${cid}/confirm`,{version:1,reason:"Own",confirmHumanCriteria:true});assert.equal(r.status,200,JSON.stringify(r.body));
   const common=structuredClone(f.doc.body.hazards[0]) as unknown as Record<string,unknown>;delete common.likelihood;delete common.severity;
   const h={...common,id:randomUUID(),...(c.method==="three_level"?{levelId:a}:c.method==="checklist"?{checklistItemId:a,outcome:"noncompliant"}:{exposurePath:"Own exposure",additionalPlanDecision:"further_review"})};
   const body={...f.doc.body,method:c.method,hazards:c.method==="checklist"?[h,{...h,id:randomUUID(),checklistItemId:b}]:[h]};
   r=await f.send("post","/risk-assessments",{body,criteriaId:cid});assert.equal(r.status,200,JSON.stringify(r.body));const id=r.body.id;
   r=await f.send("post",`/risk-assessments/${id}/submit`,{version:1,reason:"Own",confirmRecordOnly:true});assert.equal(r.status,200,JSON.stringify(r.body));const doc=r.body;
   r=await f.send("post",`/risk-assessments/${id}/reuse`,input(doc));assert.equal(r.status,200,JSON.stringify(r.body));const next=r.body;
   assert.deepEqual(next.criteria_snapshot,doc.criteria_snapshot);assert.equal(next.body.hazards.length,1);assert.equal(next.body.hazards[0].judgmentReason,"");
   assert.equal(next.body.hazards[0][c.method==="three_level"?"levelId":c.method==="checklist"?"outcome":"additionalPlanDecision"],null);
   assert.equal((await f.send("post",`/risk-assessments/${next.id}/submit`,{version:1,reason:"Still incomplete",confirmRecordOnly:true})).status,400);
  }
 }finally{f.db.close();}
});
test("reuse source bytes survive schema31 migration and synthetic backup fresh restore",async()=>{
 const f=await methodFixture();
 const {mkdtemp,rm}=await import("node:fs/promises"),{join}=await import("node:path"),{tmpdir}=await import("node:os"),{backup,DatabaseSync}=await import("node:sqlite"),{createBackup,restoreBackup}=await import("../scripts/local-backup.js"),{openDatabase}=await import("../server/db.js");
 const dir=await mkdtemp(join(tmpdir(),"pedit-reuse-"));
 try{
  const before=f.db.prepare("SELECT * FROM risk_assessments ORDER BY id").all(),oldFile=join(dir,"old.sqlite");
  await backup(f.db,oldFile);const old=new DatabaseSync(oldFile);old.exec("DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE IF EXISTS education_catalog_use_stops; DROP TABLE IF EXISTS cost_baseline_statements; DROP TABLE IF EXISTS cost_baselines; DROP TABLE IF EXISTS ppe_return_entries; DROP TRIGGER IF EXISTS ppe_return_terminal_state; DROP TABLE IF EXISTS work_plan_review_events; DROP TABLE IF EXISTS work_plan_document_reviews; DROP TABLE IF EXISTS cost_stock_receipts; DROP TRIGGER IF EXISTS cost_stock_split_guard; DROP TRIGGER IF EXISTS cost_stock_split_undo_guard; DROP TABLE IF EXISTS minutes_followup_events; DROP TABLE IF EXISTS minutes_followups; DROP TABLE IF EXISTS minutes_snapshots; DROP TABLE IF EXISTS minutes_records; DROP TRIGGER IF EXISTS minutes_final_fixed; DROP TRIGGER IF EXISTS minutes_final_retained; DROP TABLE IF EXISTS tbm_risk_references; DROP TABLE risk_reuse_sources; PRAGMA user_version=31;");old.close();
  const migrated=openDatabase(oldFile);try{assert.equal(migrated.prepare("PRAGMA user_version").get()?.user_version,CURRENT_SCHEMA_VERSION);assert.deepEqual(migrated.prepare("SELECT * FROM risk_assessments ORDER BY id").all(),before);assert.equal(migrated.prepare("SELECT COUNT(*) n FROM risk_reuse_sources").get()?.n,0);}finally{migrated.close();}
  const r=await f.send("post",`/risk-assessments/${f.doc.id}/reuse`,input(f.doc));assert.equal(r.status,200);
  const evidence=f.db.prepare("SELECT * FROM risk_reuse_sources").all(),docs=f.db.prepare("SELECT * FROM risk_assessments ORDER BY id").all(),file=join(dir,"source.sqlite");
  await backup(f.db,file);await createBackup(file,join(dir,"bundle"));const restored=await restoreBackup(join(dir,"bundle"),join(dir,"restored"));const db=new DatabaseSync(restored.databasePath);
  try{assert.equal(db.prepare("PRAGMA user_version").get()?.user_version,CURRENT_SCHEMA_VERSION);assert.deepEqual(db.prepare("SELECT * FROM risk_reuse_sources").all(),evidence);assert.deepEqual(db.prepare("SELECT * FROM risk_assessments ORDER BY id").all(),docs);assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);}finally{db.close();}
 }finally{f.db.close();await rm(dir,{recursive:true,force:true});}
});
