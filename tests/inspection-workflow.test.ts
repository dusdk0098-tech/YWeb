import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import {openDatabase} from "../server/db.js";
import {createApp} from "../server/app.js";
import {inspectionRecord} from "../server/inspection-model.js";
type Inspection=ReturnType<typeof inspectionRecord>;
async function fixture(){
  const db = openDatabase(":memory:"),
    origin = "http://127.0.0.1:3000",
    password = randomUUID(),
    hash = await argon2.hash(password);
  const ids = {
      manager: randomUUID(),
      editor: randomUUID(),
      other: randomUUID(),
      viewer: randomUUID(),
      outside: randomUUID(),
    },
    site = randomUUID();
  for (const [name, id] of Object.entries(ids))
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
      id,
      name + "@example.test",
      name,
      hash,
    );
  db.prepare("INSERT INTO sites(id,name) VALUES(?,'task site')").run(site);
  for (const [name, role] of [
    ["manager", "manager"],
    ["editor", "editor"],
    ["other", "manager"],
    ["viewer", "viewer"],
  ] as const)
    db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(
      site,
      ids[name],
      role,
    );
  const app = await createApp(db, { origin, secret: "x".repeat(48) });
  async function login(name: keyof typeof ids) {
    const agent = request.agent(app);
    let r = await agent.get("/api/session");
    r = await agent
      .post("/api/login")
      .set("Origin", origin)
      .set("x-csrf-token", r.body.csrf)
      .send({ email: name + "@example.test", password });
    assert.equal(r.status, 200);
    return { agent, csrf: r.body.csrf };
  }
  const m = await login("manager"),
    ed = await login("editor"),
    viewer = await login("viewer"),
    outside = await login("outside");
  const write = (
    u: typeof m,
    method: "post" | "put",
    path: string,
    body: object,
    key = randomUUID(),
  ) =>
    u.agent[method](path)
      .set("Origin", origin)
      .set("x-csrf-token", u.csrf)
      .set("idempotency-key", key)
      .send(body);
  const base = `/api/sites/${site}`,
    tasks = base + "/inspection-tasks";

 const other=await login("other");
 let r=await write(m,"post",base+"/inspection-templates",{title:"Own %_ 양식",instructions:"Own instructions",items:["바닥 자체 질문"]});assert.equal(r.status,200);r=await write(m,"post",base+`/inspection-templates/${r.body.id}/publish`,{version:1});assert.equal(r.status,200);const template=r.body;
 const input={templateId:template.id,assigneeId:ids.editor,body:{plannedDate:"2026-10-28",location:"Own unique location",instructions:"Own plan"}};
 r=await write(m,"post",tasks,input);assert.equal(r.status,200);const task=r.body.record;
 const query=(actor:typeof m,extra="")=>actor.agent.get(base+"/inspection-task-register?asOfDate=2026-10-29"+extra);
 async function submit(actor:typeof m,value:Inspection){let response=await write(actor,"put",base+`/inspections/${value.id}`,{version:value.version,body:{...value.body,performedBy:"Synthetic",answers:value.body.answers.map(a=>({...a,result:"pass"}))}});assert.equal(response.status,200,response.text);response=await write(actor,"post",base+`/inspections/${value.id}/submit`,{version:response.body.version});assert.equal(response.status,200,response.text);return response.body as Inspection;}
 return {db,site,ids,m,ed,other,viewer,outside,write,base,tasks,template,input,task,query,submit};
}
test("find template and personal scheduled work continues through stop/start/return/new owner/independent acceptance",async()=>{
 const f=await fixture();try{
 let r=await f.viewer.agent.get(f.base+"/inspection-template-register?keyword="+encodeURIComponent("%_"));assert.equal(r.body.total,1);const selection=r.body.items[0].use;
 assert.equal((await f.viewer.agent.get(f.base+"/inspection-template-register?keyword="+encodeURIComponent("바닥"))).body.total,1);
 r=await f.query(f.ed,"&work=my_start");assert.equal(r.body.total,1);assert.equal(r.body.items[0].elapsed,true);assert.equal((await f.viewer.agent.get(f.base+"/inspection-task-register?asOfDate=2026-10-28")).body.items[0].elapsed,false);
 const frozen=f.db.prepare("SELECT published_snapshot FROM inspection_templates WHERE id=?").get(f.template.id),taskSnapshot=f.db.prepare("SELECT template_snapshot FROM inspection_tasks WHERE id=?").get(f.task.id);
 r=await f.write(f.m,"post",f.base+`/inspection-templates/${f.template.id}/stop-use`,{version:f.template.version,sourceHash:selection.sourceHash,reason:"Own stop",confirmNoUndo:true});assert.equal(r.status,200,r.text);
 assert.equal((await f.write(f.m,"post",f.tasks,f.input)).status,409);
 const createBody={date:"2026-10-28",location:"Own",performedBy:"",answers:f.template.body.items.map((x:{id:string})=>({itemId:x.id,result:"pending",comment:""}))};
 assert.equal((await f.write(f.ed,"post",f.base+"/inspections",{templateId:f.template.id,body:createBody})).status,409);
 r=await f.write(f.ed,"post",f.tasks+`/${f.task.id}/start`,{version:1});assert.equal(r.status,200,r.text);let current=r.body.inspection as Inspection;assert.equal(current.body.answers[0].result,"pending");assert.equal((await f.query(f.ed,"&work=my_drafts")).body.total,1);
 current=await f.submit(f.ed,current);assert.equal((await f.query(f.ed,"&work=my_submitted")).body.total,1);assert.equal((await f.query(f.m,"&work=reviewable")).body.total,1);
 r=await f.write(f.m,"post",f.base+`/inspections/${current.id}/return`,{version:current.version,reason:"Own rework",authorId:f.ids.manager});assert.equal(r.status,200,r.text);current=r.body.next;assert.equal(current.body.answers[0].result,"pending");
 assert.equal((await f.query(f.ed,"&work=my_drafts")).body.total,0);r=await f.query(f.m,"&work=my_drafts");assert.equal(r.body.total,1);assert.equal(r.body.items[0].assigneeId,f.ids.editor);assert.equal(r.body.items[0].currentOwnerId,f.ids.manager);
 current=await f.submit(f.m,current);assert.equal((await f.query(f.m,"&work=reviewable")).body.total,0);assert.equal((await f.query(f.other,"&work=reviewable")).body.total,1);
 assert.equal((await f.write(f.m,"post",f.base+`/inspections/${current.id}/accept`,{version:current.version,reason:"No self review"})).status,403);
 r=await f.write(f.other,"post",f.base+`/inspections/${current.id}/accept`,{version:current.version,reason:"Own document review"});assert.equal(r.status,200,r.text);
 r=await f.query(f.ed);assert.equal(r.body.items[0].stage,"accepted");assert.equal(r.body.items[0].elapsed,false);
 assert.deepEqual(f.db.prepare("SELECT published_snapshot FROM inspection_templates WHERE id=?").get(f.template.id),frozen);assert.deepEqual(f.db.prepare("SELECT template_snapshot FROM inspection_tasks WHERE id=?").get(f.task.id),taskSnapshot);
 assert.equal((await f.m.agent.get(f.base+"/inspection-register?work=mine&status=accepted")).body.total,1);assert.equal((await f.ed.agent.get(f.base+"/inspection-register?work=mine&history=current")).body.total,0);
 }finally{f.db.close();}
});
test("more than1000 candidates returns no partial count and raw filters can refine",async()=>{
 const f=await fixture();try{
 for(let i=0;i<999;i++)f.db.prepare("INSERT INTO inspection_tasks SELECT ?,site_id,template_id,template_snapshot,?,assignee_id,status,version,root_inspection_id,created_by,created_at,updated_at FROM inspection_tasks WHERE id=?").run(randomUUID(),JSON.stringify({...f.input.body,location:"Bulk synthetic"}),f.task.id);
 const exact=(await f.query(f.m)).body,next=(await f.query(f.m,"&offset=50")).body;assert.equal(exact.total,1000);assert.equal(exact.items.length,50);assert.equal(next.total,1000);assert.equal(new Set([...exact.items,...next.items].map(x=>x.id)).size,100);
 f.db.prepare("INSERT INTO inspection_tasks SELECT ?,site_id,template_id,template_snapshot,?,assignee_id,status,version,root_inspection_id,created_by,created_at,updated_at FROM inspection_tasks WHERE id=?").run(randomUUID(),JSON.stringify({...f.input.body,location:"Bulk synthetic"}),f.task.id);
 assert.equal((await f.query(f.m)).status,409);const r=await f.query(f.ed,"&keyword=unique");assert.equal(r.status,200,r.text);assert.equal(r.body.total,1);assert.equal(r.body.candidateCount,1);
 assert.equal((await f.query(f.m,"&from=2026-10-29&to=2026-10-28")).status,400);
 const extra=await f.write(f.m,"post",f.tasks,{...f.input,body:{...f.input.body,location:"Cancelled fixture"}});assert.equal(extra.status,200);
 assert.equal((await f.write(f.m,"post",f.tasks+`/${extra.body.record.id}/cancel`,{version:1,reason:"Synthetic cancellation"})).status,200);
 const cancelled=(await f.query(f.m,"&keyword=Cancelled")).body.items[0];assert.equal(cancelled.stage,"cancelled");assert.equal(cancelled.elapsed,false);
 }finally{f.db.close();}
});
test("existing100-link ambiguity stays unknown instead of complete or not-overdue",async()=>{
 const {createInspectionDraft}=await import("../server/inspection-write.js"),{carryTaskSource}=await import("../server/inspection-schedule-model.js");
 const f=await fixture();try{
 const start=await f.write(f.ed,"post",f.tasks+`/${f.task.id}/start`,{version:1});assert.equal(start.status,200);let current=start.body.inspection as Inspection;
 f.db.exec("BEGIN");for(let i=0;i<100;i++){
  const next=createInspectionDraft(f.db,f.site,current.template_id,JSON.stringify(current.template_snapshot),f.ids.editor,current.body,current.id);carryTaskSource(f.db,current.id,next);
  f.db.prepare("UPDATE inspections SET status='returned' WHERE id=?").run(current.id);current={...current,id:next,parent_id:current.id};
 }f.db.exec("COMMIT");
 let r=await f.query(f.m);assert.equal(r.status,200,r.text);assert.equal(r.body.items[0].stage,"unknown");assert.equal(r.body.items[0].elapsed,null);assert.equal(r.body.items[0].inspectionId,null);assert.equal(r.body.items[0].canReview,false);
 assert.equal((await f.query(f.m,"&due=not_elapsed")).body.total,0);assert.equal((await f.query(f.m,"&due=unknown")).body.total,1);
 r=await f.query(f.ed,"&work=my_drafts");assert.equal(r.body.total,0);
 }finally{f.db.close();}
});
test("new selection/stop rejects mismatches and unknown fields, preserves old request receipt and existing draft visibility",async()=>{
 const f=await fixture();try{
 const old=f.db.prepare("SELECT request FROM idempotency WHERE scope=?").get(`inspection-task:create:${f.site}`);assert.equal(old?.request,JSON.stringify(f.input));
 let r=await f.write(f.m,"post",f.base+"/inspection-templates",{title:"Own draft",instructions:"",items:["Own"]});assert.equal(r.status,200);assert.equal((await f.viewer.agent.get(f.base+"/inspection-template-register?status=draft")).body.total,1);
 const source=(await f.m.agent.get(f.base+`/inspection-templates/${f.template.id}/use-status`)).body;
 assert.equal((await f.write(f.m,"post",f.tasks,{...f.input,templateHash:"a".repeat(64)})).status,409);
 assert.equal((await f.write(f.m,"post",f.tasks,{...f.input,templateVersion:1})).status,409);
 assert.equal((await f.write(f.m,"post",f.tasks,{...f.input,legalSchedule:true})).status,400);
 const stop={version:f.template.version,sourceHash:source.sourceHash,reason:"Own stop",confirmNoUndo:true};
 assert.equal((await f.write(f.viewer,"post",f.base+`/inspection-templates/${f.template.id}/stop-use`,stop)).status,403);
 assert.equal((await f.write(f.m,"post",f.base+`/inspection-templates/${f.template.id}/stop-use`,{...stop,confirmNoUndo:false})).status,400);
 f.db.exec("CREATE TRIGGER synthetic_inspection_stop_fault BEFORE INSERT ON inspection_template_use_stops BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END;");
 assert.equal((await f.write(f.m,"post",f.base+`/inspection-templates/${f.template.id}/stop-use`,stop)).status,500);assert.equal(f.db.prepare("SELECT count(*) n FROM inspection_template_use_stops").get()?.n,0);f.db.exec("DROP TRIGGER synthetic_inspection_stop_fault");
 const key=randomUUID();r=await f.write(f.m,"post",f.tasks,{...f.input,templateVersion:f.template.version,templateHash:source.sourceHash},key);assert.equal(r.status,200,r.text);const receipt=r.text;
 const started=await f.write(f.ed,"post",f.tasks+`/${f.task.id}/start`,{version:1});assert.equal(started.status,200);const submitted=await f.submit(f.ed,started.body.inspection);
 const fixed=f.db.prepare("SELECT submitted_snapshot FROM inspections WHERE id=?").get(submitted.id),print=(await f.viewer.agent.get(f.base+`/inspections/${submitted.id}/print`)).text;
 r=await f.write(f.m,"post",f.base+`/inspection-templates/${f.template.id}/stop-use`,stop);assert.equal(r.status,200,r.text);
 assert.equal((await f.write(f.m,"post",f.tasks,{...f.input,templateVersion:f.template.version,templateHash:source.sourceHash},key)).text,receipt);
 assert.throws(()=>f.db.prepare("DELETE FROM inspection_template_use_stops WHERE template_id=?").run(f.template.id));
 assert.deepEqual(f.db.prepare("SELECT submitted_snapshot FROM inspections WHERE id=?").get(submitted.id),fixed);assert.equal((await f.viewer.agent.get(f.base+`/inspections/${submitted.id}/print`)).text,print);
 assert.equal((await f.outside.agent.get(f.base+"/inspection-template-register")).status,403);
 }finally{f.db.close();}
});
test("schema39 migration and exact backup preserve fixed templates, scheduled source, stops and records",async()=>{
 const {mkdtemp,rm}=await import("node:fs/promises"),{join}=await import("node:path"),{tmpdir}=await import("node:os"),{backup,DatabaseSync}=await import("node:sqlite"),{createBackup,restoreBackup}=await import("../scripts/local-backup.js");
 const f=await fixture(),dir=await mkdtemp(join(tmpdir(),"inspection-workflow-"));try{
 const before=f.db.prepare("SELECT * FROM inspection_templates").all(),file=join(dir,"old.sqlite");await backup(f.db,file);const old=new DatabaseSync(file);old.exec("DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE work_plan_attachment_events; DROP TABLE work_plan_attachments; DROP TABLE minutes_attachment_events; DROP TABLE minutes_attachments; DROP TABLE inspection_template_use_stops; PRAGMA user_version=39");old.close();const migrated=openDatabase(file);try{assert.equal(migrated.prepare("PRAGMA user_version").get()?.user_version,CURRENT_SCHEMA_VERSION);assert.deepEqual(migrated.prepare("SELECT * FROM inspection_templates").all(),before);assert.equal(migrated.prepare("SELECT count(*) n FROM inspection_template_use_stops").get()?.n,0);}finally{migrated.close();}
 const source=(await f.m.agent.get(f.base+`/inspection-templates/${f.template.id}/use-status`)).body;
 assert.equal((await f.write(f.m,"post",f.base+`/inspection-templates/${f.template.id}/stop-use`,{version:f.template.version,sourceHash:source.sourceHash,reason:"Own stop",confirmNoUndo:true})).status,200);
 assert.equal((await f.write(f.ed,"post",f.tasks+`/${f.task.id}/start`,{version:1})).status,200);
 const tables=["inspection_templates","inspection_template_use_stops","inspection_tasks","inspection_task_links","inspection_task_events","inspections","inspection_events"],rows=Object.fromEntries(tables.map(t=>[t,f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
 const current=join(dir,"current.sqlite");await backup(f.db,current);await createBackup(current,join(dir,"bundle"));const restored=await restoreBackup(join(dir,"bundle"),join(dir,"restored")),db=new DatabaseSync(restored.databasePath);try{assert.equal(db.prepare("PRAGMA user_version").get()?.user_version,CURRENT_SCHEMA_VERSION);for(const t of tables)assert.deepEqual(db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),rows[t]);assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);}finally{db.close();}
 }finally{f.db.close();await rm(dir,{recursive:true,force:true});}
});
