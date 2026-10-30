import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { backup,DatabaseSync } from "node:sqlite";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { methodFixture } from "./fixtures/risk-method-fixture.js";
import { openDatabase } from "../server/db.js";
import { createBackup,restoreBackup } from "../scripts/local-backup.js";
import { printFinalMinutes } from "../server/minutes-print.js";
import { meetingInput } from "../server/validation.js";
import { correctedMinutesBody,validateMinutesFinal,minutesHash } from "../server/minutes-model.js";
const body=meetingInput.parse({title:"Synthetic <minutes>",type:"안전보건협의체",date:"2026-10-28",time:"09:00",location:"Synthetic room",attendees:"Synthetic participant entry",agenda:"Synthetic agenda",discussion:"Synthetic discussion",decisions:"Synthetic decision <text>",actions:[{task:"Synthetic action",owner:"Free-text owner",due:"2026-11-01",status:"완료"}]});
async function create(f:Awaited<ReturnType<typeof methodFixture>>){const r=await f.send("post","/minutes",body);assert.equal(r.status,200,JSON.stringify(r.body));return r.body;}
async function finalize(f:Awaited<ReturnType<typeof methodFixture>>){const doc=await create(f),r=await f.send("post",`/minutes/${doc.id}/finalize`,{version:doc.version,confirmRecordOnly:true});assert.equal(r.status,200,JSON.stringify(r.body));return r.body;}
test("minutes provisional final completeness and correction resets only copied manual action status",()=>{
 validateMinutesFinal(body);for(const key of ["attendees","agenda","discussion","decisions"] as const)assert.throws(()=>validateMinutesFinal({...body,[key]:" "}));
 const next=correctedMinutesBody(body);assert.equal(next.actions[0].status,"대기");assert.equal(body.actions[0].status,"완료");assert.equal(next.decisions,body.decisions);
});
test("minutes real app final archive historical names print and reasoned correction are immutable",async()=>{
 const f=await methodFixture();try{
 let doc=await create(f);assert.equal(doc.status,"draft");assert.equal(doc.snapshot,null);
 let r=await f.send("put",`/minutes/${doc.id}`,{...body,version:doc.version});assert.equal(r.status,200);doc=r.body;
 const key=randomUUID(),input={version:doc.version,confirmRecordOnly:true};r=await f.send("post",`/minutes/${doc.id}/finalize`,input,key);assert.equal(r.status,200);doc=r.body;
 assert.deepEqual((await f.send("post",`/minutes/${doc.id}/finalize`,input,key)).body,doc);
 const original=f.db.prepare("SELECT * FROM minutes WHERE id=?").get(doc.id),snap=f.db.prepare("SELECT * FROM minutes_snapshots WHERE minutes_id=?").get(doc.id),html=(await f.agent.get(f.base+`/minutes/${doc.id}/print`)).text;
 assert.match(html,/Synthetic &lt;minutes&gt;/);assert.match(html,/확정 당시 후속 항목/);assert.match(html,/당시 수기 상태 완료/);assert.equal(minutesHash(doc.snapshot.body),doc.snapshot.hash);
 f.db.prepare("UPDATE users SET name=? WHERE id=?").run("Changed current account",f.manager);f.db.prepare("UPDATE sites SET name=? WHERE id=?").run("Changed current site",f.site);
 assert.equal((await f.agent.get(f.base+`/minutes/${doc.id}/print`)).text,html);
 assert.equal((await f.send("put",`/minutes/${doc.id}`,{...body,version:doc.version,title:"Changed"})).status,409);
 assert.throws(()=>f.db.prepare("UPDATE minutes SET body='{}' WHERE id=?").run(doc.id),/immutable/);
 assert.throws(()=>f.db.prepare("DELETE FROM minutes_snapshots WHERE minutes_id=?").run(doc.id),/retained/);
 r=await f.reviewSend(`/minutes/${doc.id}/revise`,{version:doc.version,reason:"Synthetic correction reason"});assert.equal(r.status,200);const next=r.body;
 assert.equal(next.status,"draft");assert.equal(next.version,1);assert.equal(next.parentId,doc.id);assert.equal(next.actions[0].status,"대기");assert.equal(next.snapshot,null);assert.equal(next.authorId,f.reviewer);assert.equal(next.revisionReason,"Synthetic correction reason");
 assert.equal((await f.reviewSend(`/minutes/${doc.id}/revise`,{version:doc.version,reason:"Duplicate"})).status,409);
 assert.deepEqual(f.db.prepare("SELECT * FROM minutes WHERE id=?").get(doc.id),original);assert.deepEqual(f.db.prepare("SELECT * FROM minutes_snapshots WHERE minutes_id=?").get(doc.id),snap);assert.equal((await f.agent.get(f.base+`/minutes/${doc.id}/print`)).text,html);
 assert.equal((await f.agent.get(f.base+`/minutes/${doc.id}`)).body.successorId,next.id);
 }finally{f.db.close();}
});
test("minutes followups are independent reports/other-manager confirmations with retained history and correction source",async()=>{
 const f=await methodFixture();try{
 const doc=await finalize(f),fixed=f.db.prepare("SELECT * FROM minutes_snapshots WHERE minutes_id=?").get(doc.id),print=(await f.agent.get(f.base+`/minutes/${doc.id}/print`)).text;
 const input={version:doc.version,snapshotHash:doc.snapshot.hash,actionIndex:0,assigneeId:f.manager,due:"2026-11-02",reason:"Synthetic tracking",confirmManualTracking:true};
 let r=await f.reviewSend(`/minutes/${doc.id}/followups`,input);assert.equal(r.status,200,JSON.stringify(r.body));let follow=r.body;const path=`/minutes-followups/${follow.id}`;
 assert.equal(follow.status,"assigned");assert.equal(follow.source.action.status,"완료");assert.equal(follow.report,null);assert.equal(follow.verification,null);
 assert.equal((await f.reviewSend(`/minutes/${doc.id}/followups`,input)).status,409);
 assert.equal((await f.reviewSend(path+"/report",{version:follow.version,text:"Not assigned",claimedLocalDate:"2026-10-28",reason:"Synthetic",confirmHumanReport:true})).status,403);
 r=await f.send("post",path+"/report",{version:follow.version,text:"Synthetic actual human entry",claimedLocalDate:"2026-10-28",reason:"Synthetic report",confirmHumanReport:true});assert.equal(r.status,200);follow=r.body;
 const verify={version:follow.version,note:"Human confirmation record",reportHash:follow.reportHash,reason:"Synthetic confirm",confirmHumanRecord:true};
 assert.equal((await f.send("post",path+"/verify",verify)).status,403);assert.equal((await f.reviewSend(path+"/verify",{...verify,reportHash:"0".repeat(64)})).status,409);
 r=await f.reviewSend(path+"/verify",verify);assert.equal(r.status,200);follow=r.body;assert.equal(follow.status,"verified");
 const board=async(q:string)=>(await f.agent.get(f.base+"/minutes-followups"+q)).body.items.length;
 assert.deepEqual([await board(""),await board("?open=1"),await board("?mine=1"),await board("?mine=1&open=1")],[1,0,1,0]);
 assert.equal((await f.agent.get(f.base+"/minutes-followups?mine=yes")).status,400);
 assert.equal((await f.send("post",path+"/report",{version:follow.version,text:"Cannot change verified",claimedLocalDate:"2026-10-28",reason:"Synthetic",confirmHumanReport:true})).status,409);
 r=await f.reviewSend(path+"/reopen",{version:follow.version,reason:"Synthetic reopen"});assert.equal(r.status,200);follow=r.body;assert.equal(follow.report,null);assert.equal(follow.verification,null);
 r=await f.reviewSend(path+"/assign",{version:follow.version,assigneeId:f.reviewer,due:"2026-11-03",reason:"Synthetic reassignment"});assert.equal(r.status,200);follow=r.body;
 assert.equal((await f.send("post",path+"/report",{version:follow.version,text:"Old assignee",claimedLocalDate:"2026-10-28",reason:"Synthetic",confirmHumanReport:true})).status,403);
 r=await f.reviewSend(`/minutes/${doc.id}/revise`,{version:doc.version,reason:"New meeting correction"});assert.equal(r.status,200);assert.equal((await f.agent.get(f.base+path)).body.sourceHasSuccessor,true);
 r=await f.reviewSend(path+"/report",{version:follow.version,text:"Old linked action remains",claimedLocalDate:"2026-10-28",reason:"Synthetic",confirmHumanReport:true});assert.equal(r.status,200);
 assert.equal(f.db.prepare("SELECT count(*) n FROM minutes_followups").get()?.n,1);
 const events=(await f.agent.get(f.base+path+"/events")).body.items;assert.equal(events.length,6);assert.equal(events[0].event,"assigned");assert.equal(events[2].event,"verified");assert.match(events[2].snapshot,/Human confirmation record/);
 assert.throws(()=>f.db.prepare("UPDATE minutes_followup_events SET reason='x'" ).run(),/immutable/);
 assert.deepEqual(f.db.prepare("SELECT * FROM minutes_snapshots WHERE minutes_id=?").get(doc.id),fixed);assert.equal((await f.agent.get(f.base+`/minutes/${doc.id}/print`)).text,print);
 }finally{f.db.close();}
});
test("minutes feature guards current role/site/version and rolls back final/assignment audit failures",async()=>{
 const f=await methodFixture();try{
 let doc=await create(f);f.db.prepare("UPDATE memberships SET role='editor' WHERE site_id=? AND user_id=?").run(f.site,f.manager);
 assert.equal((await f.send("post",`/minutes/${doc.id}/finalize`,{version:1,confirmRecordOnly:true})).status,403);
 f.db.prepare("UPDATE memberships SET role='manager' WHERE site_id=? AND user_id=?").run(f.site,f.manager);
 f.db.exec("CREATE TRIGGER fail_minutes_audit BEFORE INSERT ON audit WHEN NEW.event='minutes.finalized' BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END;");
 assert.equal((await f.send("post",`/minutes/${doc.id}/finalize`,{version:1,confirmRecordOnly:true})).status,500);assert.equal((await f.agent.get(f.base+`/minutes/${doc.id}`)).body.status,"draft");assert.equal(f.db.prepare("SELECT count(*) n FROM minutes_snapshots").get()?.n,0);f.db.exec("DROP TRIGGER fail_minutes_audit");
 doc=(await f.send("post",`/minutes/${doc.id}/finalize`,{version:1,confirmRecordOnly:true})).body;
 const input={version:doc.version,snapshotHash:doc.snapshot.hash,actionIndex:0,assigneeId:f.manager,due:"2026-11-02",reason:"Synthetic",confirmManualTracking:true};
 assert.equal((await f.reviewSend(`/minutes/${doc.id}/followups`,{...input,version:1})).status,409);assert.equal((await f.reviewSend(`/minutes/${doc.id}/followups`,{...input,actionIndex:1})).status,400);
 const other=randomUUID();f.db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(other,"Other synthetic");f.db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(other,f.manager,"manager");assert.equal((await f.agent.get(`/api/sites/${other}/minutes/${doc.id}`)).status,404);
 f.db.exec("CREATE TRIGGER fail_followup_event BEFORE INSERT ON minutes_followup_events BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END;");
 assert.equal((await f.reviewSend(`/minutes/${doc.id}/followups`,input)).status,500);assert.equal(f.db.prepare("SELECT count(*) n FROM minutes_followups").get()?.n,0);f.db.exec("DROP TRIGGER fail_followup_event");
 }finally{f.db.close();}
});
test("schema33 legacy minutes stay editable drafts and schema34 backup restores fixed and followup records",async()=>{
 const f=await methodFixture(),dir=await mkdtemp(join(tmpdir(),"minutes-records-"));try{
 const legacy=await create(f),before=f.db.prepare("SELECT * FROM minutes WHERE id=?").get(legacy.id),file=join(dir,"legacy.sqlite");await backup(f.db,file);const old=new DatabaseSync(file);
 old.exec("DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE IF EXISTS education_catalog_use_stops; DROP TABLE IF EXISTS cost_baseline_statements; DROP TABLE IF EXISTS cost_baselines; DROP TABLE IF EXISTS ppe_return_entries; DROP TRIGGER IF EXISTS ppe_return_terminal_state; DROP TABLE IF EXISTS work_plan_review_events; DROP TABLE IF EXISTS work_plan_document_reviews; DROP TABLE IF EXISTS cost_stock_receipts; DROP TRIGGER IF EXISTS cost_stock_split_guard; DROP TRIGGER IF EXISTS cost_stock_split_undo_guard; DROP TABLE minutes_followup_events; DROP TABLE minutes_followups; DROP TABLE minutes_snapshots; DROP TABLE minutes_records; DROP TRIGGER minutes_final_fixed; DROP TRIGGER minutes_final_retained; PRAGMA user_version=33;");old.close();
 const migrated=openDatabase(file);try{assert.equal(migrated.prepare("PRAGMA user_version").get()?.user_version,CURRENT_SCHEMA_VERSION);assert.deepEqual(migrated.prepare("SELECT * FROM minutes WHERE id=?").get(legacy.id),before);assert.equal(migrated.prepare("SELECT count(*) n FROM minutes_snapshots").get()?.n,0);assert.equal(migrated.prepare("SELECT count(*) n FROM minutes_records").get()?.n,0);migrated.prepare("UPDATE minutes SET version=version+1 WHERE id=?").run(legacy.id);}finally{migrated.close();}
 const doc=await finalize(f);let r=await f.reviewSend(`/minutes/${doc.id}/followups`,{version:doc.version,snapshotHash:doc.snapshot.hash,actionIndex:0,assigneeId:f.manager,due:"2026-11-02",reason:"Synthetic backup",confirmManualTracking:true});assert.equal(r.status,200);
 r=await f.send("post",`/minutes-followups/${r.body.id}/report`,{version:1,text:"Synthetic preserved report",claimedLocalDate:"2026-10-28",reason:"Synthetic",confirmHumanReport:true});assert.equal(r.status,200);
 const tables=["minutes","minutes_records","minutes_snapshots","minutes_followups","minutes_followup_events"],rows=Object.fromEntries(tables.map(t=>[t,f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
 const current=join(dir,"current.sqlite");await backup(f.db,current);await createBackup(current,join(dir,"bundle"));const restored=await restoreBackup(join(dir,"bundle"),join(dir,"restored")),db=new DatabaseSync(restored.databasePath);try{assert.equal(db.prepare("PRAGMA user_version").get()?.user_version,CURRENT_SCHEMA_VERSION);for(const t of tables)assert.deepEqual(db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),rows[t]);assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);}finally{db.close();}
 }finally{f.db.close();await rm(dir,{recursive:true,force:true});}
});

test("minutes final HTML retains long text and all50 manual action rows with escaped last content",async()=>{
 const f=await methodFixture();try{
  const long={...body,agenda:"가".repeat(19990)+"<LAST>",actions:Array.from({length:50},(_,i)=>({...body.actions[0],task:`Synthetic action ${i}`}))};
  assert.equal(meetingInput.safeParse({...long,actions:[...long.actions,long.actions[0]]}).success,false);
  let r=await f.send("post","/minutes",long);assert.equal(r.status,200);const id=r.body.id;
  r=await f.send("post",`/minutes/${id}/finalize`,{version:1,confirmRecordOnly:true});assert.equal(r.status,200);
  const html=printFinalMinutes(r.body.snapshot);assert.match(html,/&lt;LAST&gt;/);assert.match(html,/Synthetic action 49/);assert.equal((html.match(/<article>/g)||[]).length,50);
  const input={version:r.body.version,snapshotHash:r.body.snapshot.hash,actionIndex:49,assigneeId:f.manager,due:"2026-11-02",reason:"Synthetic final row",confirmManualTracking:true};
  assert.equal((await f.reviewSend(`/minutes/${id}/followups`,input)).status,200);assert.equal((await f.reviewSend(`/minutes/${id}/followups`,{...input,actionIndex:50})).status,400);
 }finally{f.db.close();}
});
