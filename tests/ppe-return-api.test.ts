import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { movementHash,stockItem,stockState,type StockMovement } from "../server/stock-model.js";
import {stockText} from "../server/stock-quantity.js";
const origin = "http://127.0.0.1:3000";
async function setup() {
  const db = openDatabase(":memory:"),
    manager = randomUUID(),
    site = randomUUID(),
    password = randomUUID();
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
    manager,
    "synthetic@example.test",
    "Synthetic",
    await argon2.hash(password),
  );
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(
    site,
    "Synthetic site",
  );
  db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(
    site,
    manager,
    "manager",
  );
  const app = await createApp(db, {
      origin,
      secret: "synthetic-business-only".repeat(3),
    }),
    agent = request.agent(app);
  let r = await agent.get("/api/session");
  r = await agent
    .post("/api/login")
    .set("Origin", origin)
    .set("x-csrf-token", r.body.csrf)
    .send({ email: "synthetic@example.test", password });
  assert.equal(r.status, 200);
  const csrf = r.body.csrf,
    base = `/api/sites/${site}`;
  const send = (
    method: "post" | "put",
    path: string,
    body: object,
    key = randomUUID(),
  ) =>
    agent[method](base + path)
      .set("Origin", origin)
      .set("x-csrf-token", csrf)
      .set("idempotency-key", key)
      .send(body);
  return { db, manager, site, agent, base, send };
}

async function fixture(){
 const f=await setup();
 let r=await f.send("post","/workers",{name:"Synthetic worker",affiliation:"Synthetic",kind:"worker"});assert.equal(r.status,200,r.text);const worker=r.body;
 r=await f.send("post","/stock-items",{name:"Synthetic PPE",unit:"ea"});assert.equal(r.status,200);const item=r.body;
 r=await f.send("post",`/stock-items/${item.id}/movements`,{version:1,kind:"opening",quantity:"1",effectiveDate:"2026-10-28",reason:"Synthetic opening"});assert.equal(r.status,200);
 r=await f.send("post","/ppe-issues",{confirmIssue:true,workerId:worker.id,workerVersion:1,affiliationVersion:0,companyVersion:null,itemId:item.id,itemVersion:2,quantity:"0.3",effectiveDate:"2026-10-28",trade:"",location:"Synthetic",reason:"Synthetic issue"});assert.equal(r.status,200,r.text);const issue=r.body,path=`/ppe-issues/${issue.id}`;
 const read=async()=>{const v=await f.agent.get(f.base+path+"/returns");assert.equal(v.status,200,v.text);return v.body;};
 const input=async()=>{const v=await read();return {version:v.issue.version,itemVersion:v.itemVersion,effectiveDate:"2026-10-28",reason:"Synthetic return"};};
 return {...f,item,issue,path,read,input};
}
test("real routes retain completion after three partial cancellations at ordinary cap",async()=>{
 const f=await fixture();try{
 const before=f.db.prepare("SELECT original,original_hash FROM ppe_issues WHERE id=?").get(f.issue.id);let target="";
 const ins=f.db.prepare("INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
 for(let i=3;i<=1000;i++){
  const m:Omit<StockMovement,"hash">={id:randomUUID(),item_id:f.item.id,sequence:i,kind:"receipt",quantity:"0.000001",direction:1,effective_date:"2026-10-28",reason:"Synthetic capacity",reverses_id:null,actor_id:f.manager,actor_name:"Synthetic",recorded_at:"Synthetic",item_snapshot:JSON.stringify({id:f.item.id,siteId:f.site,name:f.item.name,unit:f.item.unit}),balance_after:stockText(700000n+BigInt(i-2))};ins.run(...Object.values(m),movementHash(m));target=m.id;
 }
 for(let i=0;i<3;i++){
  const body={...await f.input(),kind:"partial",quantity:"0.1",confirmBoundedPolicy:true},key=randomUUID();
  let r=await f.send("post",f.path+"/returns",body,key);assert.equal(r.status,200,r.text);
  const p=r.body.entries.at(-1);assert.equal((await f.send("post",f.path+"/returns",body,key)).text,r.text);
  const external=await f.send("post",`/stock-items/${f.item.id}/movements/${p.movementId}/reverse`,{version:r.body.itemVersion,effectiveDate:"2026-10-28",reason:"Not allowed"});assert.equal(external.status,409);
  r=await f.send("post",f.path+"/returns/"+p.id+"/cancel",{...await f.input(),confirmCancelWholeEntry:true});assert.equal(r.status,200,r.text);
 }
 let r=await f.send("post",f.path+"/returns",{...await f.input(),kind:"partial",quantity:"0.1",confirmBoundedPolicy:true});assert.equal(r.status,409);
 r=await f.send("post",f.path+"/return",{...await f.input(),confirmFullReturn:true});assert.equal(r.status,409);
 r=await f.send("post",f.path+"/returns",{...await f.input(),kind:"terminal",quantity:"0.3",confirmBoundedPolicy:true});assert.equal(r.status,200,r.text);assert.equal(r.body.summary.remainingQuantity,"0");assert.equal(r.body.issue.status,"returned");
 const terminal=r.body,partial=terminal.entries.find((e:{kind:string})=>e.kind==="partial");
 assert.equal((await f.send("post",f.path+"/returns/"+partial.id+"/cancel",{...await f.input(),confirmCancelWholeEntry:true})).status,409);
 r=await f.send("post",`/stock-items/${f.item.id}/movements/${target}/reverse`,{version:terminal.itemVersion,effectiveDate:"2026-10-28",reason:"Synthetic reserved ordinary inverse"});assert.equal(r.status,200,r.text);
 const state=stockState(f.db,stockItem(f.db,f.site,f.item.id));assert.equal(state.originalCount,1000);assert.equal(state.reversalCount,1);assert.equal(state.ppeReturnMovementCount,7);assert.equal(state.rows.length,1008);
 assert.deepEqual(f.db.prepare("SELECT original,original_hash FROM ppe_issues WHERE id=?").get(f.issue.id),before);
 }finally{f.db.close();}
});
test("minimum current comparison observes reserved partial return without changing its source",async()=>{
 const f=await fixture();try{
  const source=f.db.prepare("SELECT original,original_hash FROM ppe_issues WHERE id=?").get(f.issue.id),path=`/stock-items/${f.item.id}/minimum`;
  assert.equal((await f.send("post",path,{expectedConfigVersion:0,expectedItemVersion:(await f.read()).itemVersion,enabled:true,minimum:"0.8",reason:"Synthetic own threshold",confirm:true})).status,200);
  assert.equal((await f.agent.get(f.base+path)).body.status,"below");
  const r=await f.send("post",f.path+"/returns",{...await f.input(),kind:"partial",quantity:"0.1",confirmBoundedPolicy:true});assert.equal(r.status,200,r.text);
  const now=(await f.agent.get(f.base+path)).body;assert.equal(now.status,"equal");assert.equal(now.balance,"0.8");assert.equal(now.configVersion,1);
  assert.deepEqual(f.db.prepare("SELECT original,original_hash FROM ppe_issues WHERE id=?").get(f.issue.id),source);
 }finally{f.db.close();}
});
test("legacy full return stays byte-compatible and cannot acquire new partials",async()=>{
 const f=await fixture();try{
 const body={...await f.input(),confirmFullReturn:true},key=randomUUID();let r=await f.send("post",f.path+"/return",body,key);assert.equal(r.status,200,r.text);assert.equal((await f.send("post",f.path+"/return",body,key)).text,r.text);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM ppe_return_entries").get()?.n,0);
 r=await f.send("post",f.path+"/returns",{...await f.input(),kind:"partial",quantity:"0.1",confirmBoundedPolicy:true});assert.equal(r.status,409);
 }finally{f.db.close();}
});
test("consumed partial cannot be cancelled; failed append rolls back, terminal retains reserved path",async()=>{
 const f=await fixture();try{
 const before=f.db.prepare("SELECT COUNT(*) n FROM stock_movements").get()?.n;
 f.db.exec("CREATE TRIGGER synthetic_return_failure BEFORE INSERT ON ppe_return_entries BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END;");
 let r=await f.send("post",f.path+"/returns",{...await f.input(),kind:"partial",quantity:"0.1",confirmBoundedPolicy:true});assert.equal(r.status,500);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM stock_movements").get()?.n,before);
 f.db.exec("DROP TRIGGER synthetic_return_failure");
 r=await f.send("post",f.path+"/returns",{...await f.input(),kind:"partial",quantity:"0.1",confirmBoundedPolicy:true});assert.equal(r.status,200,r.text);const partial=r.body.entries[0];
 assert.throws(()=>f.db.prepare("UPDATE ppe_return_entries SET snapshot='{}' WHERE id=?").run(partial.id));
 r=await f.send("post",`/stock-items/${f.item.id}/movements`,{version:r.body.itemVersion,kind:"issue",quantity:"0.8",effectiveDate:"2026-10-28",reason:"Synthetic consumption"});assert.equal(r.status,200,r.text);
 r=await f.send("post",f.path+"/returns/"+partial.id+"/cancel",{...await f.input(),confirmCancelWholeEntry:true});assert.equal(r.status,409);
 r=await f.send("post",f.path+"/returns",{...await f.input(),kind:"terminal",quantity:"0.2",confirmBoundedPolicy:true});assert.equal(r.status,200,r.text);
 assert.throws(()=>f.db.prepare("UPDATE ppe_issues SET status='issued' WHERE id=?").run(f.issue.id));
 assert.equal((await f.read()).summary.returnedQuantity,"0.3");
 }finally{f.db.close();}
});
test("schema36 migration and exact backup restore preserve legacy and new return bytes",async()=>{
 const {mkdtemp,rm}=await import("node:fs/promises"),{join}=await import("node:path"),{tmpdir}=await import("node:os"),{backup,DatabaseSync}=await import("node:sqlite"),{createBackup,restoreBackup}=await import("../scripts/local-backup.js");
 const f=await fixture(),dir=await mkdtemp(join(tmpdir(),"ppe-return-migration-"));try{
 const original=f.db.prepare("SELECT * FROM ppe_issues").all(),movements=f.db.prepare("SELECT * FROM stock_movements").all(),file=join(dir,"old.sqlite");await backup(f.db,file);
 const old=new DatabaseSync(file);old.exec("DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE IF EXISTS education_catalog_use_stops; DROP TABLE cost_baseline_statements; DROP TABLE cost_baselines; DROP TABLE ppe_return_entries; DROP TRIGGER ppe_return_terminal_state; PRAGMA user_version=36");old.close();
 const migrated=openDatabase(file);try{assert.equal(migrated.prepare("PRAGMA user_version").get()?.user_version,CURRENT_SCHEMA_VERSION);assert.deepEqual(migrated.prepare("SELECT * FROM ppe_issues").all(),original);assert.deepEqual(migrated.prepare("SELECT * FROM stock_movements").all(),movements);assert.equal(migrated.prepare("SELECT count(*) n FROM ppe_return_entries").get()?.n,0);}finally{migrated.close();}
 let r=await f.send("post",f.path+"/returns",{...await f.input(),kind:"partial",quantity:"0.1",confirmBoundedPolicy:true});assert.equal(r.status,200,r.text);
 r=await f.send("post",f.path+"/returns",{...await f.input(),kind:"terminal",quantity:"0.2",confirmBoundedPolicy:true});assert.equal(r.status,200,r.text);
 const tables=["ppe_issues","ppe_return_entries","ppe_events","stock_items","stock_movements","stock_events"],rows=Object.fromEntries(tables.map(t=>[t,f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
 const current=join(dir,"current.sqlite");await backup(f.db,current);await createBackup(current,join(dir,"bundle"));const restored=await restoreBackup(join(dir,"bundle"),join(dir,"restored")),db=new DatabaseSync(restored.databasePath);
 try{assert.equal(db.prepare("PRAGMA user_version").get()?.user_version,CURRENT_SCHEMA_VERSION);for(const t of tables)assert.deepEqual(db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),rows[t]);assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);}finally{db.close();}
 const html=(await f.agent.get(f.base+f.path+"/print")).text;assert.match(html,/누적 0.3 · 잔여 0/);assert.match(html,/不?변 종결|불변 종결/);assert.match(html,/부분 최대3회/);
 const page=await f.agent.get(f.base+`/stock-items/${f.item.id}/movements`);assert.equal(page.body.items.find((m:{id:string})=>m.id===r.body.entries[0].movementId).ppeRecordId,f.issue.id);
 }finally{f.db.close();await rm(dir,{recursive:true,force:true});}
});
test("large valid dedicated history keeps separate budgets and complete print with measured local read cost",async()=>{
 const {returnHash}=await import("../server/ppe-return-ledger.js"),{bindPpeReturn}=await import("../server/ppe-return-write.js"),{printStock}=await import("../server/stock-print.js");
 const f=await fixture();try{
 const r=await f.send("post","/stock-items",{name:"Synthetic large PPE pool",unit:"ea"});assert.equal(r.status,200);const item=r.body;
 let seq=0,balance=0n;const insert=f.db.prepare("INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
 function movement(kind:StockMovement["kind"],quantity:string,units:bigint,direction:1|-1,reverses:string|null=null):StockMovement{
  balance+=BigInt(direction)*units;
  const body:Omit<StockMovement,"hash">={id:randomUUID(),item_id:item.id,sequence:++seq,kind,quantity,direction,effective_date:"2026-10-28",reason:"Synthetic large history <script>",reverses_id:reverses,actor_id:f.manager,actor_name:"Synthetic",recorded_at:"2026-10-28T00:00:00.000Z",item_snapshot:JSON.stringify({id:item.id,siteId:f.site,name:item.name,unit:item.unit}),balance_after:stockText(balance)};
  const hash=movementHash(body);insert.run(...Object.values(body),hash);return {...body,hash};
 }
 f.db.exec("BEGIN");const opening=movement("opening","1000",1000000000n,1);
 const sources:{id:string;hash:string}[]=[];
 for(let i=0;i<999;i++){
  const issue=movement("issue","1",1000000n,-1),id=randomUUID(),original=JSON.stringify({...f.issue.original,id,item:{id:item.id,name:item.name,unit:item.unit},quantity:"1",issueMovementId:issue.id}),hash=returnHash(original);
  f.db.prepare("INSERT INTO ppe_issues(id,site_id,worker_id,item_id,issue_movement_id,original,original_hash,status,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'issued',1,?,?)").run(id,f.site,f.issue.worker_id,item.id,issue.id,original,hash,"synthetic","synthetic");sources.push({id,hash});
 }
 for(const source of sources){
  for(let i=0;i<3;i++){
   const m=movement("adjust_in","0.1",100000n,1),id=randomUUID();
   const snapshot={id,issueId:source.id,sourceHash:source.hash,movementId:m.id,kind:"partial" as const,quantity:"0.1",cancelsId:null,effectiveDate:m.effective_date,reason:m.reason,actor:{id:f.manager,name:"Synthetic"},at:m.recorded_at};bindPpeReturn(f.db,snapshot,m);
   const inverse=movement("reversal","0.1",100000n,-1,m.id);bindPpeReturn(f.db,{...snapshot,id:randomUUID(),kind:"cancel",cancelsId:id},inverse);
  }
  const m=movement("adjust_in","1",1000000n,1);bindPpeReturn(f.db,{id:randomUUID(),issueId:source.id,sourceHash:source.hash,movementId:m.id,kind:"terminal",quantity:"1",cancelsId:null,effectiveDate:m.effective_date,reason:m.reason,actor:{id:f.manager,name:"Synthetic"},at:m.recorded_at},m);
  f.db.prepare("UPDATE ppe_issues SET status='returned' WHERE id=?").run(source.id);
 }
 movement("reversal","1000",1000000000n,-1,opening.id);f.db.exec("COMMIT");
 const start=performance.now(),state=stockState(f.db,stockItem(f.db,f.site,item.id)),readMs=performance.now()-start;
 assert.equal(state.rows.length,7994);assert.equal(state.originalCount,1000);assert.equal(state.reversalCount,1);assert.equal(state.ppeReturnMovementCount,6993);assert.equal(state.balance,0n);
 const printStart=performance.now(),html=printStock(item,state.rows,"0"),printMs=performance.now()-printStart;
 assert.equal((html.match(/<tr>/g)||[]).length,7995);assert.ok(!html.includes("<script>"));assert.match(html,/상한9000건/);
 console.log(JSON.stringify({fixture:"synthetic7994",readMs:Number(readMs.toFixed(2)),printMs:Number(printMs.toFixed(2)),htmlBytes:Buffer.byteLength(html)}));
 }finally{f.db.close();}
});
test("new return ordinary input/site-role guards and correction linkage cannot select reserved quota",async()=>{
 const f=await fixture();try{
 const input={...await f.input(),kind:"partial",quantity:"0.1",confirmBoundedPolicy:true};
 assert.equal((await f.send("post",f.path+"/returns",{...input,ppeReturn:{issueId:f.issue.id,kind:"terminal"}})).status,400);
 assert.equal((await f.send("post",`/stock-items/${f.item.id}/movements`,{version:3,kind:"adjust_in",quantity:"0.1",effectiveDate:"2026-10-28",reason:"Cannot choose quota",ppeReturn:{issueId:f.issue.id,kind:"partial"}})).status,400);
 assert.equal((await f.send("post",f.path+"/returns",{...input,effectiveDate:"2026-10-27"})).status,409);
 assert.equal((await f.send("post",f.path+"/returns",{...input,quantity:"0.4"})).status,409);
 assert.equal(f.db.prepare("SELECT count(*) n FROM ppe_return_entries").get()?.n,0);
 const r=await f.send("post",f.path+"/returns",input);assert.equal(r.status,200,r.text);
 assert.equal((await f.send("post",f.path+"/notes",{version:r.body.issue.version,reason:"Do not reuse dedicated return",correctionMovementId:r.body.entries[0].movementId})).status,409);
 f.db.prepare("UPDATE memberships SET role='editor' WHERE site_id=? AND user_id=?").run(f.site,f.manager);
 assert.equal((await f.agent.get(f.base+f.path+"/returns")).status,403);
 assert.equal((await f.send("post",f.path+"/returns",input)).status,403);
 }finally{f.db.close();}
});
