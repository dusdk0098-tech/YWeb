import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { methodFixture } from "./fixtures/risk-method-fixture.js";
import { planReviewInput } from "../server/work-plan-review.js";
const body={title:"Synthetic general plan",date:"2026-10-28",startTime:"09:00",endTime:"10:00",location:"Synthetic",workDescription:"Synthetic",emergencyProcedure:"Synthetic",verificationNote:"No engineering claim",steps:[{task:"Task",procedure:"Procedure",precaution:"Precaution"}],equipmentIds:[],duties:[]};
async function draft(f:Awaited<ReturnType<typeof methodFixture>>,duties:{workerId:string;duty:string}[]=[]){let r=await f.send("post","/work-plans",{body:{...body,duties}});assert.equal(r.status,200);r=await f.send("post",`/work-plans/${r.body.id}/capture`,{version:1});assert.equal(r.status,200);return r.body;}
async function submitted(f:Awaited<ReturnType<typeof methodFixture>>,duties:{workerId:string;duty:string}[]=[]){const d=await draft(f,duties),r=await f.send("post",`/work-plans/${d.id}/submit`,{version:d.version,reason:"Synthetic submission",confirmDocumentOnly:true});assert.equal(r.status,200,JSON.stringify(r.body));return r.body;}
test("work plan documentary review requires exact input and explicit current correction author",()=>{
 const v={version:1,submissionHash:"a".repeat(64),decision:"returned",reason:"Synthetic",confirmDocumentOnly:true};assert.equal(planReviewInput.safeParse(v).success,false);assert.equal(planReviewInput.safeParse({...v,authorId:randomUUID()}).success,true);assert.equal(planReviewInput.safeParse({...v,authorId:randomUUID(),workPermit:true}).success,false);
});
test("author submission freezes source; other manager accepts document without changing original print",async()=>{
 const f=await methodFixture();try{const doc=await submitted(f),path=`/work-plans/${doc.id}`;
 const source=f.db.prepare("SELECT * FROM work_plan_snapshots WHERE plan_id=?").get(doc.id),html=(await f.agent.get(f.base+path+"/print")).text;
 assert.match(html,/작성자 제출본/);assert.doesNotMatch(html,/관리자 기록 보관본/);
 const view=(await f.agent.get(f.base+path+"/document-review")).body,input={version:view.review.version,submissionHash:view.review.submission_hash,decision:"accepted",reason:"Synthetic document review",confirmDocumentOnly:true};
 assert.equal((await f.send("post",path+"/review",input)).status,403);assert.equal((await f.reviewSend(path+"/revise",{version:doc.version,authorId:f.manager,reason:"Cannot skip pending review"})).status,409);
 const r=await f.reviewSend(path+"/review",input);assert.equal(r.status,200);assert.equal(r.body.documentReview.review.status,"accepted");assert.equal(r.body.nextDraft,null);
 assert.deepEqual(f.db.prepare("SELECT * FROM work_plan_snapshots WHERE plan_id=?").get(doc.id),source);assert.equal((await f.agent.get(f.base+path+"/print")).text,html);
 assert.equal((await f.send("put",path,{version:doc.version,body})).status,409);
 const next=await f.reviewSend(path+"/revise",{version:doc.version,authorId:f.manager,reason:"New correction"});assert.equal(next.status,200);assert.equal(next.body.source_capture,null);assert.equal((await f.agent.get(f.base+`/work-plans/${next.body.id}/document-review`)).body.kind,"draft");
 }finally{f.db.close();}
});
test("changed or unavailable reference blocks acceptance but allows explicit-author return and fresh resubmission",async()=>{
 const f=await methodFixture();try{const worker=randomUUID();f.db.prepare("INSERT INTO workers VALUES(?,?,?,?,?,1,1,?,?)").run(worker,f.site,"Synthetic worker","Synthetic","worker","now","now");
 const doc=await submitted(f,[{workerId:worker,duty:"Human duty"}]),path=`/work-plans/${doc.id}`;const source=f.db.prepare("SELECT * FROM work_plan_snapshots WHERE plan_id=?").get(doc.id);
 f.db.prepare("UPDATE workers SET name=?,version=version+1 WHERE id=?").run("Changed worker",worker);
 let view=(await f.agent.get(f.base+path+"/document-review")).body;assert.equal(view.referenceState.state,"changed");
 const input={version:view.review.version,submissionHash:view.review.submission_hash,reason:"Synthetic correction needed",confirmDocumentOnly:true};assert.equal((await f.reviewSend(path+"/review",{...input,decision:"accepted"})).status,409);
 f.db.prepare("UPDATE workers SET active=0,version=version+1 WHERE id=?").run(worker);view=(await f.agent.get(f.base+path+"/document-review")).body;assert.equal(view.referenceState.state,"unavailable");
 const foreign=randomUUID();assert.equal((await f.reviewSend(path+"/review",{...input,decision:"returned",authorId:foreign})).status,400);assert.equal(f.db.prepare("SELECT count(*) n FROM work_plans WHERE parent_id=?").get(doc.id)?.n,0);
 let r=await f.reviewSend(path+"/review",{...input,decision:"returned",authorId:f.manager});assert.equal(r.status,200);const next=r.body.nextDraft;assert.equal(next.status,"draft");assert.equal(next.source_capture,null);assert.equal(next.parent_id,doc.id);assert.equal(r.body.documentReview.review.status,"returned");
 assert.equal((await f.send("post",`/work-plans/${next.id}/submit`,{version:next.version,reason:"No recapture",confirmDocumentOnly:true})).status,409);
 r=await f.send("put",`/work-plans/${next.id}`,{version:next.version,body});assert.equal(r.status,200);r=await f.send("post",`/work-plans/${next.id}/capture`,{version:r.body.version});assert.equal(r.status,200);r=await f.send("post",`/work-plans/${next.id}/submit`,{version:r.body.version,reason:"Revised human document",confirmDocumentOnly:true});assert.equal(r.status,200);
 assert.deepEqual(f.db.prepare("SELECT * FROM work_plan_snapshots WHERE plan_id=?").get(doc.id),source);
 }finally{f.db.close();}
});
test("legacy archived work plans remain unreviewed with identical original print",async()=>{
 const f=await methodFixture();try{const d=await draft(f);const r=await f.reviewSend(`/work-plans/${d.id}/archive`,{version:d.version});assert.equal(r.status,200);const doc=r.body,source=f.db.prepare("SELECT * FROM work_plan_snapshots WHERE plan_id=?").get(doc.id);
 const view=(await f.agent.get(f.base+`/work-plans/${doc.id}/document-review`)).body;assert.equal(view.kind,"unreviewed_archive");assert.equal(view.review,null);assert.match((await f.agent.get(f.base+`/work-plans/${doc.id}/print`)).text,/관리자 기록 보관본/);assert.deepEqual(f.db.prepare("SELECT * FROM work_plan_snapshots WHERE plan_id=?").get(doc.id),source);
 assert.equal((await f.reviewSend(`/work-plans/${doc.id}/review`,{version:1,submissionHash:doc.snapshot.hash,decision:"accepted",reason:"Cannot retroactively accept",confirmDocumentOnly:true})).status,409);
 }finally{f.db.close();}
});
test("equipment reference changes and retirement are warnings; invalid author and audit failure never create correction",async()=>{
 const f=await methodFixture();try{
 const equipment=randomUUID();f.db.prepare("INSERT INTO equipment VALUES(?,?,?,?,'active',1,'now','now')").run(equipment,f.site,"",JSON.stringify({assetCode:"",name:"Synthetic equipment",typeLabel:"manual",model:"",serial:"",ownerCompany:"",notes:""}));
 let r=await f.send("post","/work-plans",{body:{...body,equipmentIds:[equipment]}});assert.equal(r.status,200);const id=r.body.id,path=`/work-plans/${id}`;
 assert.equal((await f.reviewSend(path+"/submit",{version:1,reason:"Not author",confirmDocumentOnly:true})).status,403);
 r=await f.send("post",path+"/capture",{version:1});assert.equal(r.status,200);
 f.db.exec("CREATE TRIGGER fail_plan_submit BEFORE INSERT ON work_plan_review_events WHEN NEW.event='submitted' BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END;");
 const input={version:r.body.version,reason:"Synthetic submission",confirmDocumentOnly:true};assert.equal((await f.send("post",path+"/submit",input)).status,500);assert.equal((await f.agent.get(f.base+path)).body.status,"draft");assert.equal(f.db.prepare("SELECT count(*) n FROM work_plan_snapshots WHERE plan_id=?").get(id)?.n,0);f.db.exec("DROP TRIGGER fail_plan_submit");
 const key=randomUUID();r=await f.send("post",path+"/submit",input,key);assert.equal(r.status,200);assert.deepEqual((await f.send("post",path+"/submit",input,key)).body,r.body);
 const before=f.db.prepare("SELECT * FROM work_plan_snapshots WHERE plan_id=?").get(id);
 f.db.prepare("UPDATE equipment SET version=version+1 WHERE id=?").run(equipment);let view=(await f.agent.get(f.base+path+"/document-review")).body;assert.equal(view.referenceState.state,"changed");
 const v={version:view.review.version,submissionHash:view.review.submission_hash,decision:"returned",authorId:f.manager,reason:"Synthetic return",confirmDocumentOnly:true};
 assert.equal((await f.reviewSend(path+"/review",{...v,decision:"accepted",authorId:undefined})).status,409);
 f.db.prepare("UPDATE equipment SET status='retired',version=version+1 WHERE id=?").run(equipment);view=(await f.agent.get(f.base+path+"/document-review")).body;assert.equal(view.referenceState.state,"unavailable");
 f.db.prepare("UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?").run(f.site,f.manager);assert.equal((await f.reviewSend(path+"/review",v)).status,400);assert.equal(f.db.prepare("SELECT count(*) n FROM work_plans WHERE parent_id=?").get(id)?.n,0);f.db.prepare("UPDATE memberships SET role='manager' WHERE site_id=? AND user_id=?").run(f.site,f.manager);
 f.db.exec("CREATE TRIGGER fail_plan_review BEFORE INSERT ON work_plan_review_events WHEN NEW.event='returned' BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END;");
 assert.equal((await f.reviewSend(path+"/review",v)).status,500);assert.equal(f.db.prepare("SELECT count(*) n FROM work_plans WHERE parent_id=?").get(id)?.n,0);assert.equal((await f.agent.get(f.base+path+"/document-review")).body.review.status,"submitted");f.db.exec("DROP TRIGGER fail_plan_review");
 const decisionKey=randomUUID();r=await f.reviewSend(path+"/review",v,decisionKey);assert.equal(r.status,200);assert.deepEqual((await f.reviewSend(path+"/review",v,decisionKey)).body,r.body);
 assert.equal((await f.reviewSend(path+"/review",v)).status,409);assert.deepEqual(f.db.prepare("SELECT * FROM work_plan_snapshots WHERE plan_id=?").get(id),before);
 const events=(await f.agent.get(f.base+path+"/review-events")).body.items;assert.equal(events.length,2);assert.equal(events[0].event,"submitted");assert.equal(events[1].event,"returned");assert.throws(()=>f.db.exec("UPDATE work_plan_review_events SET reason='changed'"),/immutable/);
 }finally{f.db.close();}
});
test("schema35 archived bytes and print remain unreviewed; schema36 backup preserves submissions decisions and correction drafts",async()=>{
 const {mkdtemp,rm}=await import("node:fs/promises"),{join}=await import("node:path"),{tmpdir}=await import("node:os"),{backup,DatabaseSync}=await import("node:sqlite"),{openDatabase}=await import("../server/db.js"),{createBackup,restoreBackup}=await import("../scripts/local-backup.js"),{printWorkPlan}=await import("../server/work-plan-print.js");
 const f=await methodFixture(),dir=await mkdtemp(join(tmpdir(),"work-plan-review-"));try{
 const d=await draft(f),old=(await f.reviewSend(`/work-plans/${d.id}/archive`,{version:d.version})).body,original=f.db.prepare("SELECT * FROM work_plan_snapshots WHERE plan_id=?").get(d.id),html=(await f.agent.get(f.base+`/work-plans/${d.id}/print`)).text;
 const file=join(dir,"old.sqlite");await backup(f.db,file);const prior=new DatabaseSync(file);prior.exec("DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE IF EXISTS education_catalog_use_stops; DROP TABLE IF EXISTS cost_baseline_statements; DROP TABLE IF EXISTS cost_baselines; DROP TABLE IF EXISTS ppe_return_entries; DROP TRIGGER IF EXISTS ppe_return_terminal_state; DROP TABLE work_plan_review_events; DROP TABLE work_plan_document_reviews; PRAGMA user_version=35");prior.close();
 const migrated=openDatabase(file);try{assert.equal(migrated.prepare("PRAGMA user_version").get()?.user_version,CURRENT_SCHEMA_VERSION);assert.deepEqual(migrated.prepare("SELECT * FROM work_plan_snapshots WHERE plan_id=?").get(d.id),original);assert.equal(migrated.prepare("SELECT count(*) n FROM work_plan_document_reviews").get()?.n,0);assert.equal(printWorkPlan(old.snapshot.body,old.snapshot.hash),html);}finally{migrated.close();}
 const doc=await submitted(f),view=(await f.agent.get(f.base+`/work-plans/${doc.id}/document-review`)).body;
 assert.equal((await f.reviewSend(`/work-plans/${doc.id}/review`,{version:1,submissionHash:view.review.submission_hash,decision:"returned",authorId:f.manager,reason:"Synthetic backup return",confirmDocumentOnly:true})).status,200);
 const tables=["work_plans","work_plan_snapshots","work_plan_document_reviews","work_plan_review_events"],rows=Object.fromEntries(tables.map(t=>[t,f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
 const current=join(dir,"current.sqlite");await backup(f.db,current);await createBackup(current,join(dir,"bundle"));const restored=await restoreBackup(join(dir,"bundle"),join(dir,"restored")),db=new DatabaseSync(restored.databasePath);try{assert.equal(db.prepare("PRAGMA user_version").get()?.user_version,CURRENT_SCHEMA_VERSION);for(const t of tables)assert.deepEqual(db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),rows[t]);assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);}finally{db.close();}
 }finally{f.db.close();await rm(dir,{recursive:true,force:true});}
});
