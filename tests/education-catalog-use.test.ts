import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import {openDatabase} from "../server/db.js";
import {createApp} from "../server/app.js";
import {catalogInstantiateInput} from "../server/education-catalog.js";
const body={title:"Synthetic %_ 교육",categoryLabel:"자체 분류",objectives:"Own objectives",contents:"Own authored literal 바닥 내용",referenceNote:"Own note"};
const schedule={date:"2026-10-28",startTime:"09:00",endTime:"10:00",breakMinutes:0,instructor:"Synthetic",location:"Synthetic"};
async function fixture(){
 const db=openDatabase(":memory:");const site=randomUUID(),manager=randomUUID(),editor=randomUUID(),password=randomUUID(),hash=await argon2.hash(password),origin="http://127.0.0.1:3000";
 db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site,"Synthetic");for(const [id,role] of [[manager,"manager"],[editor,"editor"]]){db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(id,role+"@example.test",role,hash);db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site,id,role);}
 const app=await createApp(db,{origin,secret:"synthetic-catalog-only".repeat(3)});
 async function login(name:string){const agent=request.agent(app);let r=await agent.get("/api/session");r=await agent.post("/api/login").set("Origin",origin).set("x-csrf-token",r.body.csrf).send({email:name+"@example.test",password});assert.equal(r.status,200);return {agent,csrf:r.body.csrf as string};}
 const m=await login("manager"),e=await login("editor"),base=`/api/sites/${site}/education-catalog`,edu=`/api/sites/${site}/education`,register=`/api/sites/${site}/education-catalog-register`;
 const post=(a:typeof m,path:string,value:object,key=randomUUID())=>a.agent.post(path).set("Origin",origin).set("x-csrf-token",a.csrf).set("idempotency-key",key).send(value);
 let r=await post(m,base,{body});assert.equal(r.status,200);r=await post(m,base+`/${r.body.id}/publish`,{version:1});assert.equal(r.status,200);return {db,site,manager,editor,m,e,base,edu,register,post,catalog:r.body};
}
test("optional selected hash preserves legacy parsed payload bytes and rejects extra certificates",()=>{
 const v={version:2,schedule};assert.equal(JSON.stringify(catalogInstantiateInput.parse(v)),JSON.stringify(v));
 assert.deepEqual(Object.keys(catalogInstantiateInput.parse({...v,sourceHash:"a".repeat(64)})),["version","schedule","sourceHash"]);
 assert.equal(catalogInstantiateInput.safeParse({...v,legalCourseCode:"invented"}).success,false);
});
test("search literal fields, visible lineage, count and deterministic50 pages do not disclose draft successor",async()=>{
 const f=await fixture();try{
 let r=await f.post(f.m,f.base+`/${f.catalog.id}/revise`,{version:f.catalog.version,reason:"Own revision"});assert.equal(r.status,200);const child=r.body;
 r=await f.e.agent.get(f.register+"?keyword="+encodeURIComponent("%_"));assert.equal(r.body.total,1);assert.equal(JSON.stringify(r.body).includes(child.id),false);assert.equal(r.body.items[0].current.publishedSuccessor,null);
 assert.equal((await f.e.agent.get(f.register+"?lineage=visible_leaf")).body.total,1);assert.equal((await f.e.agent.get(f.register+"?lineage=has_visible_successor")).body.total,0);
 assert.equal((await f.m.agent.get(f.register+"?lineage=has_visible_successor")).body.total,1);
 assert.equal((await f.e.agent.get(f.register+"?status=draft")).body.total,0);
 assert.equal((await f.e.agent.get(f.register+"?keyword="+encodeURIComponent("바닥"))).body.total,1);
 assert.equal((await f.e.agent.get(f.register+"?keyword="+encodeURIComponent("자체 분류"))).body.total,1);
 for(let i=0;i<51;i++)f.db.prepare("INSERT INTO education_catalog VALUES(?,?,NULL,?,'draft',1,NULL,NULL,'same','same')").run(randomUUID(),f.site,JSON.stringify({...body,title:"Paging"}));
 const first=(await f.m.agent.get(f.register+"?keyword=Paging")).body,second=(await f.m.agent.get(f.register+"?keyword=Paging&offset=50")).body;assert.equal(first.total,51);assert.equal(first.items.length,50);assert.equal(second.items.length,1);assert.equal(first.hasMore,true);assert.equal(second.hasMore,false);assert.equal(new Set([...first.items,...second.items].map(x=>x.id)).size,51);
 r=await f.post(f.m,f.base+`/${child.id}/publish`,{version:child.version});assert.equal(r.status,200);
 const current=(await f.e.agent.get(f.base+`/${f.catalog.id}/use-status`)).body;assert.equal(current.publishedSuccessor.id,child.id);assert.equal(current.useStopped,false);
 }finally{f.db.close();}
});
test("explicit irreversible stop blocks new creation but preserves exact prior receipt/source/print and no participation inherited",async()=>{
 const f=await fixture();try{
 const input={version:f.catalog.version,schedule,sourceHash:f.catalog.published_hash},key=randomUUID();let r=await f.post(f.e,f.base+`/${f.catalog.id}/journals`,input,key);assert.equal(r.status,200,r.text);const journal=r.body,receipt=r.text;
 assert.equal(journal.participants.length,0);
 const worker=randomUUID();f.db.prepare("INSERT INTO workers VALUES(?,?,?,'company','worker',1,1,'now','now')").run(worker,f.site,"Synthetic participant");f.db.prepare("INSERT INTO education_participants VALUES(?,?,?,?,?,'attended',30,?,'now')").run(journal.id,worker,"Synthetic participant","company","worker",f.editor);
 r=await f.post(f.m,f.edu+`/${journal.id}/archive`,{version:journal.version});assert.equal(r.status,200,r.text);
 const frozen=f.db.prepare("SELECT * FROM education_snapshots WHERE session_id=?").get(journal.id);
 const source=f.db.prepare("SELECT * FROM education_catalog WHERE id=?").get(f.catalog.id),link=f.db.prepare("SELECT * FROM education_catalog_links WHERE session_id=?").get(journal.id),print=(await f.e.agent.get(f.edu+`/${journal.id}/print`)).text;
 const stop={version:f.catalog.version,sourceHash:f.catalog.published_hash,reason:"Own content needs revision",confirmNoUndo:true};
 assert.equal((await f.post(f.e,f.base+`/${f.catalog.id}/stop-use`,stop)).status,403);
 assert.equal((await f.post(f.m,f.base+`/${f.catalog.id}/stop-use`,{...stop,confirmNoUndo:false})).status,400);
 assert.equal((await f.post(f.m,f.base+`/${f.catalog.id}/stop-use`,{...stop,sourceHash:"a".repeat(64)})).status,409);
 r=await f.post(f.m,f.base+`/${f.catalog.id}/stop-use`,stop);assert.equal(r.status,200,r.text);assert.equal(r.body.useStopped,true);
 assert.equal((await f.post(f.e,f.base+`/${f.catalog.id}/journals`,input)).status,409);
 assert.equal((await f.post(f.e,f.base+`/${f.catalog.id}/journals`,{version:f.catalog.version,schedule})).status,409);
 assert.equal((await f.post(f.e,f.base+`/${f.catalog.id}/journals`,input,key)).text,receipt);
 assert.equal((await f.e.agent.get(f.edu+`/${journal.id}/catalog-use-status`)).body.current.useStopped,true);
 assert.deepEqual(f.db.prepare("SELECT * FROM education_catalog WHERE id=?").get(f.catalog.id),source);assert.deepEqual(f.db.prepare("SELECT * FROM education_catalog_links WHERE session_id=?").get(journal.id),link);assert.equal((await f.e.agent.get(f.edu+`/${journal.id}/print`)).text,print);assert.deepEqual(f.db.prepare("SELECT * FROM education_snapshots WHERE session_id=?").get(journal.id),frozen);
 assert.throws(()=>f.db.prepare("DELETE FROM education_catalog_use_stops WHERE catalog_id=?").run(f.catalog.id));
 r=await f.post(f.m,f.base+`/${f.catalog.id}/revise`,{version:f.catalog.version,reason:"Own new revision"});assert.equal(r.status,200);const child=r.body;r=await f.post(f.m,f.base+`/${child.id}/publish`,{version:child.version});assert.equal(r.status,200);const published=r.body;
 r=await f.post(f.e,f.base+`/${published.id}/journals`,{version:published.version,schedule,sourceHash:published.published_hash});assert.equal(r.status,200,r.text);assert.equal(r.body.participants.length,0);
 const current=(await f.e.agent.get(f.edu+`/${journal.id}/catalog-use-status`)).body.current;assert.equal(current.publishedSuccessor.id,published.id);assert.equal(current.useStopped,true);assert.equal((await f.e.agent.get(f.edu+`/${journal.id}/print`)).text,print);
 }finally{f.db.close();}
});
test("use-stop insert rollback, exact hash and current role checks leave source and journals unchanged",async()=>{
 const f=await fixture();try{
 const source=f.db.prepare("SELECT * FROM education_catalog WHERE id=?").get(f.catalog.id),value={version:f.catalog.version,sourceHash:f.catalog.published_hash,reason:"Synthetic stop",confirmNoUndo:true},key=randomUUID();
 assert.equal((await f.post(f.e,f.base+`/${f.catalog.id}/journals`,{version:f.catalog.version,schedule,sourceHash:"b".repeat(64)})).status,409);
 f.db.exec("CREATE TRIGGER synthetic_stop_failure BEFORE INSERT ON education_catalog_use_stops BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END;");
 assert.equal((await f.post(f.m,f.base+`/${f.catalog.id}/stop-use`,value,key)).status,500);assert.equal(f.db.prepare("SELECT count(*) n FROM education_catalog_use_stops").get()?.n,0);assert.deepEqual(f.db.prepare("SELECT * FROM education_catalog WHERE id=?").get(f.catalog.id),source);
 f.db.exec("DROP TRIGGER synthetic_stop_failure");let r=await f.post(f.m,f.base+`/${f.catalog.id}/stop-use`,value,key);assert.equal(r.status,200,r.text);const receipt=r.text;
 assert.equal((await f.post(f.m,f.base+`/${f.catalog.id}/stop-use`,value,key)).text,receipt);
 assert.equal((await f.m.agent.get(f.register+"?use=stopped")).body.total,1);assert.equal((await f.m.agent.get(f.register+"?use=available")).body.total,0);
 f.db.prepare("UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?").run(f.site,f.manager);
 r=await f.post(f.m,f.base+`/${f.catalog.id}/stop-use`,value,key);assert.equal(r.status,403);
 assert.equal(f.db.prepare("SELECT count(*) n FROM education_sessions").get()?.n,0);
 }finally{f.db.close();}
});
test("schema38 migration and backup preserve published source, stop, journal and old snapshot bytes",async()=>{
 const {mkdtemp,rm}=await import("node:fs/promises"),{join}=await import("node:path"),{tmpdir}=await import("node:os"),{backup,DatabaseSync}=await import("node:sqlite"),{createBackup,restoreBackup}=await import("../scripts/local-backup.js");
 const f=await fixture(),dir=await mkdtemp(join(tmpdir(),"catalog-use-backup-"));try{
 const before=f.db.prepare("SELECT * FROM education_catalog").all(),file=join(dir,"old.sqlite");await backup(f.db,file);const old=new DatabaseSync(file);old.exec("DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE education_catalog_use_stops; PRAGMA user_version=38");old.close();
 const migrated=openDatabase(file);try{assert.equal(migrated.prepare("PRAGMA user_version").get()?.user_version,CURRENT_SCHEMA_VERSION);assert.deepEqual(migrated.prepare("SELECT * FROM education_catalog").all(),before);assert.equal(migrated.prepare("SELECT count(*) n FROM education_catalog_use_stops").get()?.n,0);}finally{migrated.close();}
 let r=await f.post(f.e,f.base+`/${f.catalog.id}/journals`,{version:f.catalog.version,schedule});assert.equal(r.status,200,r.text);
 r=await f.post(f.m,f.base+`/${f.catalog.id}/stop-use`,{version:f.catalog.version,sourceHash:f.catalog.published_hash,reason:"Synthetic stop for backup",confirmNoUndo:true});assert.equal(r.status,200,r.text);
 const tables=["education_catalog","education_catalog_use_stops","education_catalog_links","education_sessions","education_snapshots","education_participants"],rows=Object.fromEntries(tables.map(t=>[t,f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
 const current=join(dir,"current.sqlite");await backup(f.db,current);await createBackup(current,join(dir,"bundle"));const restored=await restoreBackup(join(dir,"bundle"),join(dir,"restored")),db=new DatabaseSync(restored.databasePath);try{assert.equal(db.prepare("PRAGMA user_version").get()?.user_version,CURRENT_SCHEMA_VERSION);for(const t of tables)assert.deepEqual(db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),rows[t]);assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);}finally{db.close();}
 }finally{f.db.close();await rm(dir,{recursive:true,force:true});}
});
