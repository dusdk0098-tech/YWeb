import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { backup, DatabaseSync } from "node:sqlite";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { methodFixture } from "./fixtures/risk-method-fixture.js";
import { openDatabase } from "../server/db.js";
import { createBackup,restoreBackup } from "../scripts/local-backup.js";
import { printTbm } from "../server/tbm-print.js";
import type { TbmSnapshot } from "../server/tbm.js";
const details={title:"Synthetic TBM",date:"2026-10-28",time:"08:30",location:"Synthetic",facilitator:"Synthetic",work:"Human work",topics:"Human topics"};
async function ready(f:Awaited<ReturnType<typeof methodFixture>>) {
 let r=await f.send("post","/tbm",details);assert.equal(r.status,200,JSON.stringify(r.body));let doc=r.body;
 const w=randomUUID();f.db.prepare("INSERT INTO workers VALUES(?,?,?,?,?,1,1,?,?)").run(w,f.site,"Synthetic worker","Synthetic","worker","now","now");
 r=await f.send("post",`/tbm/${doc.id}/participants`,{version:doc.version,workerId:w});assert.equal(r.status,200);doc=r.body;
 r=await f.send("put",`/tbm/${doc.id}/participants/${w}`,{version:doc.version,state:"present"});assert.equal(r.status,200,JSON.stringify(r.body));return r.body;
}
function source(f:Awaited<ReturnType<typeof methodFixture>>) {return {assessmentId:f.doc.id,submissionVersion:f.doc.submission!.version,submissionHash:f.doc.submission_hash,hazardIds:[f.doc.body.hazards[0].id]};}
test("TBM real app fixed reference, historical explicit finalization, correction, and archived print remain stable",async()=>{
 const f=await methodFixture();try{
 let doc=await ready(f);const path=`/tbm/${doc.id}/risk-reference`,payload={version:doc.version,source:source(f)},key=randomUUID();
 const originBefore=f.db.prepare("SELECT * FROM risk_assessments WHERE id=?").get(f.doc.id);
 let r=await f.send("put",path,payload,key);assert.equal(r.status,200,JSON.stringify(r.body));doc=r.body;
 assert.deepEqual(doc.body,details);assert.equal(doc.participants[0].state,"present");assert.equal(doc.riskReference.submissionHash,f.doc.submission_hash);
 assert.deepEqual((await f.send("put",path,payload,key)).body,doc);
 assert.equal((await f.send("put",path,{...payload,source:null})).status,409);
 assert.deepEqual(f.db.prepare("SELECT * FROM risk_assessments WHERE id=?").get(f.doc.id),originBefore);
 r=await f.agent.get(f.base+path+"/source");assert.equal(r.status,200);assert.deepEqual(r.body.submission,f.doc.submission);
 const before=JSON.stringify(doc.riskReference);
 r=await f.reviewSend(`/risk-assessments/${f.doc.id}/revise`,{version:f.doc.version,reason:"Synthetic correction",authorId:f.manager});assert.equal(r.status,200);
 r=await f.agent.get(f.base+`/tbm/${doc.id}`);assert.equal(r.body.riskSourceState.sourceHasSuccessor,true);assert.equal(JSON.stringify(r.body.riskReference),before);
 assert.equal((await f.send("post",`/tbm/${doc.id}/finalize`,{version:doc.version})).status,409);
 r=await f.send("post",`/tbm/${doc.id}/finalize`,{version:doc.version,acknowledgeHistoricalSource:true});assert.equal(r.status,200,JSON.stringify(r.body));doc=r.body;
 assert.equal(doc.snapshot.body.schemaVersion,2);assert.equal(doc.snapshot.body.riskReference.historicalSourceAcknowledgment.actor.id,f.manager);
 const snap=f.db.prepare("SELECT * FROM tbm_snapshots WHERE session_id=?").get(doc.id),print=(await f.agent.get(f.base+`/tbm/${doc.id}/print`)).text;
 assert.match(print,/고정 위험성평가 출처/);assert.match(print,/확정 당시 후속 평가/);assert.match(print,new RegExp(f.doc.submission_hash!));
 assert.equal((await f.send("put",path,{version:doc.version,source:null})).status,409);
 r=await f.send("post",`/tbm/${doc.id}/revise`,{version:doc.version,reason:"Synthetic TBM correction"});assert.equal(r.status,200);const next=r.body;
 assert.equal(JSON.stringify(next.riskReference),before);assert.equal(next.snapshot,null);assert.equal(next.participants[0].state,"pending");assert.equal(next.participants[0].recorded_by,null);
 assert.deepEqual(f.db.prepare("SELECT * FROM tbm_snapshots WHERE session_id=?").get(doc.id),snap);assert.equal((await f.agent.get(f.base+`/tbm/${doc.id}/print`)).text,print);
 // A post-finalization source successor also changes only live metadata, never archived print.
 const second=await methodFixture();try{
 let d=await ready(second);d=(await second.send("put",`/tbm/${d.id}/risk-reference`,{version:d.version,source:source(second)})).body;
 d=(await second.send("post",`/tbm/${d.id}/finalize`,{version:d.version,acknowledgeHistoricalSource:true})).body;
 assert.equal(d.snapshot.body.riskReference.historicalSourceAcknowledgment,null);
 const p=(await second.agent.get(second.base+`/tbm/${d.id}/print`)).text,s=second.db.prepare("SELECT * FROM tbm_snapshots WHERE session_id=?").get(d.id);
 assert.equal((await second.reviewSend(`/risk-assessments/${second.doc.id}/revise`,{version:second.doc.version,reason:"Later source",authorId:second.manager})).status,200);
 assert.equal((await second.agent.get(second.base+`/tbm/${d.id}`)).body.riskSourceState.sourceHasSuccessor,true);
 assert.equal((await second.agent.get(second.base+`/tbm/${d.id}/print`)).text,p);assert.deepEqual(second.db.prepare("SELECT * FROM tbm_snapshots WHERE session_id=?").get(d.id),s);
 }finally{second.db.close();}
 }finally{f.db.close();}
});
test("TBM real app reference validates bounds/source/site, manager-only editing, and transaction rollback",async()=>{
 const f=await methodFixture();try{
 let doc=await ready(f);const path=`/tbm/${doc.id}/risk-reference`,v={version:doc.version,source:source(f)};
 for(const bad of [{...v.source,submissionHash:"0".repeat(64)},{...v.source,submissionVersion:1},{...v.source,hazardIds:[randomUUID()]}])assert.equal((await f.send("put",path,{...v,source:bad})).status,409);
 for(const ids of [[],[v.source.hazardIds[0],v.source.hazardIds[0]],Array.from({length:51},()=>randomUUID())])assert.equal((await f.send("put",path,{...v,source:{...v.source,hazardIds:ids}})).status,400);
 const other=randomUUID();f.db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(other,"Other synthetic");f.db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(other,f.manager,"manager");
 const cross=await f.agent.get(`/api/sites/${other}/tbm/${doc.id}/risk-reference/source`);assert.equal(cross.status,404);
 f.db.exec("CREATE TRIGGER fail_tbm_risk_audit BEFORE INSERT ON audit WHEN NEW.event='tbm.risk-reference.changed' BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END;");
 assert.equal((await f.send("put",path,v)).status,500);assert.equal(f.db.prepare("SELECT count(*) n FROM tbm_risk_references").get()?.n,0);assert.equal((await f.agent.get(f.base+`/tbm/${doc.id}`)).body.version,doc.version);f.db.exec("DROP TRIGGER fail_tbm_risk_audit");
 doc=(await f.send("put",path,v)).body;
 for(const role of ["editor","viewer"]){f.db.prepare("UPDATE memberships SET role=? WHERE site_id=? AND user_id=?").run(role,f.site,f.manager);assert.equal((await f.send("put",path,{version:doc.version,source:null})).status,403);assert.equal((await f.agent.get(f.base+path+"/source")).status,200);}
 f.db.prepare("UPDATE memberships SET role='manager' WHERE site_id=? AND user_id=?").run(f.site,f.manager);
 doc=(await f.send("put",path,{version:doc.version,source:null})).body;assert.equal(doc.riskReference,null);assert.equal((await f.agent.get(f.base+path+"/source")).status,404);
 }finally{f.db.close();}
});
test("schema32 migration and backup preserve legacy schema1 bytes/hash/print and new reference evidence",async()=>{
 const f=await methodFixture(),dir=await mkdtemp(join(tmpdir(),"tbm-risk-"));try{
 let doc=await ready(f);const legacyId=doc.id;
 const legacy:TbmSnapshot={schemaVersion:1,type:"TBM",id:legacyId,site:{id:f.site,name:"Synthetic site"},version:doc.version+1,parentId:null,revisionReason:"",details,participants:doc.participants,source:"staff-recorded",finalizedBy:{id:f.manager,name:"Synthetic"},finalizedAt:"2026-10-28T08:30:00.000Z"};
 const serialized=JSON.stringify(legacy),hash=createHash("sha256").update(serialized).digest("hex");
 f.db.prepare("UPDATE tbm_sessions SET status='finalized',version=version+1 WHERE id=?").run(legacyId);f.db.prepare("INSERT INTO tbm_snapshots VALUES(?,?,?,?,?)").run(legacyId,serialized,hash,f.manager,legacy.finalizedAt);
 const oldPrint=(await f.agent.get(f.base+`/tbm/${legacyId}/print`)).text;
 const oldFile=join(dir,"old.sqlite");await backup(f.db,oldFile);const old=new DatabaseSync(oldFile);old.exec("DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE IF EXISTS education_catalog_use_stops; DROP TABLE IF EXISTS cost_baseline_statements; DROP TABLE IF EXISTS cost_baselines; DROP TABLE IF EXISTS ppe_return_entries; DROP TRIGGER IF EXISTS ppe_return_terminal_state; DROP TABLE IF EXISTS work_plan_review_events; DROP TABLE IF EXISTS work_plan_document_reviews; DROP TABLE IF EXISTS cost_stock_receipts; DROP TRIGGER IF EXISTS cost_stock_split_guard; DROP TRIGGER IF EXISTS cost_stock_split_undo_guard; DROP TABLE IF EXISTS minutes_followup_events; DROP TABLE IF EXISTS minutes_followups; DROP TABLE IF EXISTS minutes_snapshots; DROP TABLE IF EXISTS minutes_records; DROP TRIGGER IF EXISTS minutes_final_fixed; DROP TRIGGER IF EXISTS minutes_final_retained; DROP TABLE tbm_risk_references; PRAGMA user_version=32");old.close();
 const migrated=openDatabase(oldFile);try{
 assert.equal(migrated.prepare("PRAGMA user_version").get()?.user_version,CURRENT_SCHEMA_VERSION);
 const row=migrated.prepare("SELECT body,hash FROM tbm_snapshots WHERE session_id=?").get(legacyId) as {body:string;hash:string};assert.equal(row.body,serialized);assert.equal(row.hash,hash);assert.equal(migrated.prepare("SELECT count(*) n FROM tbm_risk_references").get()?.n,0);
 assert.equal(printTbm({id:legacyId,site:"Synthetic site",details,participants:doc.participants,version:legacy.version},{body:JSON.parse(row.body),hash:row.hash}),oldPrint);
 }finally{migrated.close();}
 const r=await f.send("post",`/tbm/${legacyId}/revise`,{version:legacy.version,reason:"Legacy correction"});assert.equal(r.status,200);assert.equal(r.body.riskReference,null);assert.equal(r.body.participants[0].state,"pending");
 doc=await ready(f);doc=(await f.send("put",`/tbm/${doc.id}/risk-reference`,{version:doc.version,source:source(f)})).body;assert.equal((await f.send("post",`/tbm/${doc.id}/finalize`,{version:doc.version})).status,200);
 const file=join(dir,"current.sqlite"),refs=f.db.prepare("SELECT * FROM tbm_risk_references").all(),snaps=f.db.prepare("SELECT * FROM tbm_snapshots ORDER BY session_id").all();await backup(f.db,file);await createBackup(file,join(dir,"bundle"));const restored=await restoreBackup(join(dir,"bundle"),join(dir,"restored")),db=new DatabaseSync(restored.databasePath);
 try{assert.equal(db.prepare("PRAGMA user_version").get()?.user_version,CURRENT_SCHEMA_VERSION);assert.deepEqual(db.prepare("SELECT * FROM tbm_risk_references").all(),refs);assert.deepEqual(db.prepare("SELECT * FROM tbm_snapshots ORDER BY session_id").all(),snaps);assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);}finally{db.close();}
 }finally{f.db.close();await rm(dir,{recursive:true,force:true});}
});
