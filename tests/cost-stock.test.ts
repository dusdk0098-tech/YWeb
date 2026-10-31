import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import { closeReady } from "./fixtures/cost-close-ready.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { costStockCreateInput,stockUnchangedAcknowledgment,assertCostStockAcknowledgment,assertNoActiveCostReceipt } from "../server/cost-stock-model.js";
import { expenseEdit,costReason } from "../server/cost-validation.js";
async function fixture(){
 const db=openDatabase(":memory:");const site=randomUUID(),manager=randomUUID(),password=randomUUID(),origin="http://127.0.0.1:3000";
 db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(manager,"synthetic@example.test","Synthetic",await argon2.hash(password));db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site,"Synthetic");db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site,manager,"manager");
 const app=await createApp(db,{origin,secret:"synthetic-cost-stock-only".repeat(3)}),agent=request.agent(app);let r=await agent.get("/api/session");r=await agent.post("/api/login").set("Origin",origin).set("x-csrf-token",r.body.csrf).send({email:"synthetic@example.test",password});assert.equal(r.status,200);const csrf=r.body.csrf,base=`/api/sites/${site}`;
 const send=(path:string,body:object,key=randomUUID(),method:"post"|"put"="post")=>agent[method](base+path).set("Origin",origin).set("x-csrf-token",csrf).set("idempotency-key",key).send(body);
 r=await send("/cost-periods",{month:"2026-10",openingNote:"Own",categories:[{label:"Own purchases",plan:"10000",opening:"0"}]});assert.equal(r.status,200);let period=r.body;
 r=await send(`/cost-periods/${period.id}/expenses`,{version:period.version,expense:{categoryId:period.categories[0].id,spendDate:"2026-10-01",description:"Synthetic purchase",quantity:"99",unitPriceWon:"2"}});assert.equal(r.status,200);period=r.body.period;const expense=r.body.expense;
 r=await send("/stock-items",{name:"Synthetic PPE",unit:"개"});assert.equal(r.status,200);const item=r.body;
 return{db,site,manager,agent,base,send,period,expense,item};
}
test("optional finance acknowledgment preserves legacy parsed JSON and independent exact physical input",()=>{
 const v={version:1,reason:"Own",expense:{categoryId:randomUUID(),spendDate:"2026-10-01",description:"Own",quantity:"99",unitPriceWon:"2"}};
 assert.equal(JSON.stringify(expenseEdit.extend({stockAcknowledgment:stockUnchangedAcknowledgment.optional()}).parse(v)),JSON.stringify(expenseEdit.parse(v)));
 const reason={version:1,reason:"Own"};assert.equal(JSON.stringify(costReason.extend({stockAcknowledgment:stockUnchangedAcknowledgment.optional()}).parse(reason)),JSON.stringify(costReason.parse(reason)));
 const input={periodVersion:2,expenseVersion:1,itemId:randomUUID(),itemVersion:1,quantity:"0.100000",effectiveDate:"2026-10-28",reason:"Own",confirmSeparatePhysicalQuantity:true};
 assert.equal(costStockCreateInput.parse(input).quantity,"0.1");assert.throws(()=>costStockCreateInput.parse({...input,quantity:"0.0000001"}));assert.throws(()=>costStockCreateInput.parse({...input,quantity:"0"}));
});
test("new route exact receipt, immutable finance source, duplicate and consumed reversal rules",async()=>{
 const f=await fixture();try{
  const base=`/cost-periods/${f.period.id}/expenses/${f.expense.id}/stock-receipts`,input={periodVersion:f.period.version,expenseVersion:f.expense.version,itemId:f.item.id,itemVersion:f.item.version,quantity:"0.3",effectiveDate:"2026-10-28",reason:"Own actual receipt",confirmSeparatePhysicalQuantity:true},key=randomUUID();
  const before=f.db.prepare("SELECT * FROM cost_expenses").all(),period=f.db.prepare("SELECT * FROM cost_periods").all();
  const minPath=`/stock-items/${f.item.id}/minimum`;assert.equal((await f.send(minPath,{expectedConfigVersion:0,expectedItemVersion:f.item.version,enabled:true,minimum:"0.3",reason:"Synthetic current threshold",confirm:true})).status,200);assert.equal((await f.agent.get(f.base+minPath)).body.status,"below");
  let r=await f.send(base,input,key);assert.equal(r.status,200,JSON.stringify(r.body));const created=r.body,id=created.receipt.id;assert.equal(created.item.balance,"0.3");assert.equal((await f.agent.get(f.base+minPath)).body.status,"equal");assert.equal(created.receipt.snapshot.source.expense.quantity,"99");assert.equal(created.receipt.snapshot.physicalQuantity,"0.3");assert.deepEqual(f.db.prepare("SELECT * FROM cost_expenses").all(),before);assert.deepEqual(f.db.prepare("SELECT * FROM cost_periods").all(),period);
  assert.deepEqual((await f.send(base,input,key)).body,created);assert.equal((await f.send(base,{...input,itemVersion:created.item.version})).status,409);
  assert.throws(()=>assertCostStockAcknowledgment(f.db,f.expense.id,undefined));assert.doesNotThrow(()=>assertCostStockAcknowledgment(f.db,f.expense.id,{receiptId:id,confirmStockUnchanged:true}));assert.throws(()=>assertNoActiveCostReceipt(f.db,f.expense.id));
  r=await f.send(`/stock-items/${f.item.id}/movements`,{version:created.item.version,kind:"issue",quantity:"0.1",effectiveDate:"2026-10-28",reason:"Synthetic issue"});assert.equal(r.status,200);const issued=r.body;
  r=await f.send(`/cost-stock-receipts/${id}/reverse`,{itemVersion:issued.item.version,effectiveDate:"2026-10-28",reason:"Own",confirmFinanceUnchanged:true});assert.equal(r.status,409);assert.match(r.body.error,/잔량이 음수/);
  r=await f.send(`/stock-items/${f.item.id}/movements/${issued.movement.id}/reverse`,{version:issued.item.version,effectiveDate:"2026-10-28",reason:"Synthetic issue correction"});assert.equal(r.status,200);
  r=await f.send(`/cost-stock-receipts/${id}/reverse`,{itemVersion:r.body.item.version,effectiveDate:"2026-10-28",reason:"Own full receipt correction",confirmFinanceUnchanged:true});assert.equal(r.status,200);assert.equal(r.body.item.balance,"0");assert.equal(r.body.receipt.status,"reversed");assert.deepEqual(f.db.prepare("SELECT * FROM cost_expenses").all(),before);assert.doesNotThrow(()=>assertNoActiveCostReceipt(f.db,f.expense.id));
  assert.throws(()=>f.db.prepare("UPDATE cost_stock_receipts SET snapshot='{}' WHERE id=?").run(id));assert.throws(()=>f.db.prepare("DELETE FROM cost_stock_receipts WHERE id=?").run(id));
 }finally{f.db.close();}
});
test("closed cost source is preserved and stock/link failure rolls back atomically",async()=>{
 const f=await fixture();try{
  closeReady(f.db);let r=await f.send(`/cost-periods/${f.period.id}/close`,{version:f.period.version,reason:"Own close"});assert.equal(r.status,200);const period=r.body;
  r=await f.send(`/cost-periods/${period.id}/carry`,{version:period.version});assert.equal(r.status,200);
  assert.equal((await f.send(`/cost-periods/${period.id}/reopen`,{version:period.version,reason:"Cannot reopen carried source"})).status,409);
  const source=f.db.prepare("SELECT * FROM cost_closures").all(),expense=f.db.prepare("SELECT * FROM cost_expenses").all(),base=`/cost-periods/${period.id}/expenses/${f.expense.id}/stock-receipts`,input={periodVersion:period.version,expenseVersion:f.expense.version,itemId:f.item.id,itemVersion:f.item.version,quantity:"0.1",effectiveDate:"2026-10-28",reason:"Separate physical receipt",confirmSeparatePhysicalQuantity:true};
  f.db.exec("CREATE TRIGGER synthetic_receipt_failure BEFORE INSERT ON cost_stock_receipts BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END;");
  r=await f.send(base,input);assert.equal(r.status,500);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM stock_movements").get()?.n,0);assert.equal(f.db.prepare("SELECT version FROM stock_items WHERE id=?").get(f.item.id)?.version,f.item.version);f.db.exec("DROP TRIGGER synthetic_receipt_failure");
  r=await f.send(base,input);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.receipt.snapshot.source.closure.id,period.currentClosure.id);assert.equal(r.body.receipt.snapshot.source.closure.hash,period.currentClosure.hash);assert.deepEqual(f.db.prepare("SELECT * FROM cost_closures").all(),source);assert.deepEqual(f.db.prepare("SELECT * FROM cost_expenses").all(),expense);
  f.db.prepare("UPDATE memberships SET role='editor' WHERE site_id=?").run(f.site);assert.equal((await f.agent.get(f.base+base)).status,403);
 }finally{f.db.close();}
});
const receiptInput=(f:Awaited<ReturnType<typeof fixture>>)=>({periodVersion:f.period.version,expenseVersion:f.expense.version,itemId:f.item.id,itemVersion:f.item.version,quantity:"0.3",effectiveDate:"2026-10-28",reason:"Own actual receipt",confirmSeparatePhysicalQuantity:true});
test("linked finance edits cancel restore require current explicit ack and never change stock; direct reverse blocked",async()=>{
 const f=await fixture();try{
  const expensePath=`/cost-periods/${f.period.id}/expenses/${f.expense.id}`;let r=await f.send(expensePath+"/stock-receipts",receiptInput(f));assert.equal(r.status,200);const linked=r.body.receipt,ack={receiptId:linked.id,confirmStockUnchanged:true};
  const body={version:f.period.version,reason:"Own cost correction",expense:{categoryId:f.expense.category_id,spendDate:f.expense.spend_date,description:"Changed actual cost",quantity:"100",unitPriceWon:"2"}};
  assert.equal((await f.send(expensePath,body,randomUUID(),"put")).status,409);assert.equal((await f.send(expensePath,{...body,stockAcknowledgment:{...ack,receiptId:randomUUID()}},randomUUID(),"put")).status,409);
  r=await f.send(expensePath,{...body,stockAcknowledgment:ack},randomUUID(),"put");assert.equal(r.status,200);let period=r.body.period;
  r=await f.agent.get(f.base+`/cost-stock-receipts/${linked.id}`);assert.equal(r.body.currentSource.changed,true);assert.equal(r.body.snapshot.source.expense.quantity,"99");assert.equal(r.body.currentSource.expenseVersion,2);assert.equal(r.body.currentSource.amount,"200");
  assert.equal((await f.send(`/stock-items/${f.item.id}/movements/${linked.movement_id}/reverse`,{version:2,effectiveDate:"2026-10-28",reason:"Wrong path"})).status,409);
  r=await f.send(expensePath+"/cancel",{version:period.version,reason:"Actual cost cancellation",stockAcknowledgment:ack});assert.equal(r.status,200);period=r.body.period;
  assert.equal((await f.agent.get(f.base+`/stock-items/${f.item.id}`)).body.balance,"0.3");
  assert.equal((await f.send(expensePath+"/restore",{version:period.version,reason:"Own"})).status,409);
  r=await f.send(expensePath+"/restore",{version:period.version,reason:"Own",stockAcknowledgment:ack});assert.equal(r.status,200);period=r.body.period;
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM stock_movements").get()?.n,1);
  r=await f.send(`/cost-stock-receipts/${linked.id}/reverse`,{itemVersion:2,effectiveDate:"2026-10-28",reason:"Actual receipt error",confirmFinanceUnchanged:true});assert.equal(r.status,200);
  assert.equal((await f.send(expensePath+"/cancel",{version:period.version,reason:"Stale ack",stockAcknowledgment:ack})).status,409);
  r=await f.send(expensePath+"/cancel",{version:period.version,reason:"Legacy no active link"});assert.equal(r.status,200);assert.equal(r.body.expense.status,"cancelled");assert.equal((await f.agent.get(f.base+`/stock-items/${f.item.id}`)).body.balance,"0");
 }finally{f.db.close();}
});
test("source split and child undo are blocked by active physical receipts without changing money conservation",async()=>{
 const f=await fixture();try{
  const path=`/cost-periods/${f.period.id}`,expensePath=path+`/expenses/${f.expense.id}`,children=[{description:"A",quantity:"50",unitPriceWon:"2"},{description:"B",quantity:"49",unitPriceWon:"2"}];
  let r=await f.send(expensePath+"/stock-receipts",receiptInput(f));assert.equal(r.status,200);const linked=r.body.receipt;
  assert.equal((await f.send(expensePath+"/split",{version:f.period.version,reason:"Split",children})).status,409);
  assert.equal((await f.agent.get(f.base+expensePath+"/split-info")).body.canSplit,false);
  r=await f.send(`/cost-stock-receipts/${linked.id}/reverse`,{itemVersion:2,effectiveDate:"2026-10-28",reason:"Own full receipt correction",confirmFinanceUnchanged:true});assert.equal(r.status,200);
  r=await f.send(expensePath+"/split",{version:f.period.version,reason:"Conserving split",children});assert.equal(r.status,200,JSON.stringify(r.body));const split=r.body,child=split.snapshot.children[0];
  r=await f.send(path+`/expenses/${child.id}/stock-receipts`,{...receiptInput(f),periodVersion:split.period.version,expenseVersion:child.version,itemVersion:3,quantity:"0.1"});assert.equal(r.status,200);const childLink=r.body.receipt;
  r=await f.send(path+`/splits/${split.id}/undo`,{version:split.period.version,reason:"Undo"});assert.equal(r.status,409);
  assert.equal((await f.agent.get(f.base+path+`/splits/${split.id}`)).body.eligibility.allowed,false);
  r=await f.send(`/cost-stock-receipts/${childLink.id}/reverse`,{itemVersion:4,effectiveDate:"2026-10-28",reason:"Actual correction",confirmFinanceUnchanged:true});assert.equal(r.status,200);
  r=await f.send(path+`/splits/${split.id}/undo`,{version:split.period.version,reason:"Explicit undo"});assert.equal(r.status,200);assert.equal(r.body.period.totals.total.current,"198");
  const current=(await f.agent.get(f.base+expensePath)).body;
  r=await f.send(expensePath+"/stock-receipts",{...receiptInput(f),periodVersion:r.body.period.version,expenseVersion:current.version,itemVersion:5});assert.equal(r.status,200);assert.notEqual(r.body.receipt.id,linked.id);
 }finally{f.db.close();}
});
test("cost receipt to explicit existing PPE issue/full return to receipt reversal does not mutate finance",async()=>{
 const f=await fixture();try{
  const expensePath=`/cost-periods/${f.period.id}/expenses/${f.expense.id}`;
  let r=await f.send(expensePath+"/stock-receipts",receiptInput(f));assert.equal(r.status,200);const linked=r.body.receipt;
  const financial=f.db.prepare("SELECT * FROM cost_expenses").all();
  r=await f.send("/workers",{name:"Synthetic worker",affiliation:"Manual",kind:"worker"});assert.equal(r.status,200);const worker=r.body;
  r=await f.send("/ppe-issues",{confirmIssue:true,workerId:worker.id,workerVersion:1,affiliationVersion:0,companyVersion:null,itemId:f.item.id,itemVersion:2,quantity:"0.1",effectiveDate:"2026-10-28",trade:"",location:"Synthetic location",reason:"Explicit PPE issue"});assert.equal(r.status,200,JSON.stringify(r.body));const issue=r.body;
  assert.equal((await f.agent.get(f.base+`/stock-items/${f.item.id}`)).body.balance,"0.2");
  assert.equal((await f.send(`/cost-stock-receipts/${linked.id}/reverse`,{itemVersion:3,effectiveDate:"2026-10-28",reason:"Cannot reverse consumed stock",confirmFinanceUnchanged:true})).status,409);
  r=await f.send(`/ppe-issues/${issue.id}/return`,{version:1,itemVersion:3,effectiveDate:"2026-10-28",reason:"Actual full return",confirmFullReturn:true});assert.equal(r.status,200);
  r=await f.send(`/cost-stock-receipts/${linked.id}/reverse`,{itemVersion:4,effectiveDate:"2026-10-28",reason:"Actual receipt correction",confirmFinanceUnchanged:true});assert.equal(r.status,200);assert.equal(r.body.item.balance,"0");
  assert.deepEqual(f.db.prepare("SELECT * FROM cost_expenses").all(),financial);assert.equal((await f.agent.get(f.base+`/ppe-issues/${issue.id}`)).body.status,"returned");
 }finally{f.db.close();}
});
test("cost-linked receipt uses reserved inverse capacity at1000 originals without changing cap",async()=>{
 const f=await fixture();try{
  const {movementHash,stockState,stockItem}=await import("../server/stock-model.js");
  const insert=f.db.prepare("INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for(let sequence=1;sequence<=999;sequence++){
   const m={id:randomUUID(),item_id:f.item.id,sequence,kind:"receipt" as const,quantity:"1",direction:1 as const,effective_date:"2026-10-28",reason:"Synthetic retained cap",reverses_id:null,actor_id:f.manager,actor_name:"Synthetic",recorded_at:new Date().toISOString(),item_snapshot:JSON.stringify({id:f.item.id,siteId:f.site,name:f.item.name,unit:f.item.unit}),balance_after:String(sequence)};
   insert.run(m.id,m.item_id,m.sequence,m.kind,m.quantity,m.direction,m.effective_date,m.reason,m.reverses_id,m.actor_id,m.actor_name,m.recorded_at,m.item_snapshot,m.balance_after,movementHash(m));
  }
  f.db.prepare("UPDATE stock_items SET version=1000 WHERE id=?").run(f.item.id);
  let r=await f.send(`/cost-periods/${f.period.id}/expenses/${f.expense.id}/stock-receipts`,{...receiptInput(f),itemVersion:1000});assert.equal(r.status,200);const linked=r.body.receipt;
  assert.equal((await f.send(`/stock-items/${f.item.id}/movements`,{version:1001,kind:"receipt",quantity:"1",effectiveDate:"2026-10-28",reason:"Past cap"})).status,409);
  r=await f.send(`/cost-stock-receipts/${linked.id}/reverse`,{itemVersion:1001,effectiveDate:"2026-10-28",reason:"Actual full correction",confirmFinanceUnchanged:true});assert.equal(r.status,200);assert.equal(r.body.item.balance,"999");const state=stockState(f.db,stockItem(f.db,f.site,f.item.id));assert.equal(state.originalCount,1000);assert.equal(state.rows.length,1001);
 }finally{f.db.close();}
});
test("schema34 migration and synthetic fresh restore preserve finance and receipt/stock bytes",async()=>{
 const f=await fixture(),{mkdtemp,rm}=await import("node:fs/promises"),{join}=await import("node:path"),{tmpdir}=await import("node:os"),{backup,DatabaseSync}=await import("node:sqlite"),{createBackup,restoreBackup}=await import("../scripts/local-backup.js");
 const dir=await mkdtemp(join(tmpdir(),"pedit-cost-stock-"));try{
  const original=f.db.prepare("SELECT * FROM cost_expenses").all(),oldFile=join(dir,"old.sqlite");await backup(f.db,oldFile);const old=new DatabaseSync(oldFile);old.exec("DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE IF EXISTS education_catalog_use_stops; DROP TABLE IF EXISTS cost_baseline_statements; DROP TABLE IF EXISTS cost_baselines; DROP TABLE IF EXISTS ppe_return_entries; DROP TRIGGER IF EXISTS ppe_return_terminal_state; DROP TABLE IF EXISTS work_plan_review_events; DROP TABLE IF EXISTS work_plan_document_reviews; DROP TABLE cost_stock_receipts; DROP TRIGGER cost_stock_split_guard; DROP TRIGGER cost_stock_split_undo_guard; PRAGMA user_version=34;");old.close();
  const migrated=openDatabase(oldFile);try{assert.equal(migrated.prepare("PRAGMA user_version").get()?.user_version,CURRENT_SCHEMA_VERSION);assert.deepEqual(migrated.prepare("SELECT * FROM cost_expenses").all(),original);assert.equal(migrated.prepare("SELECT COUNT(*) n FROM cost_stock_receipts").get()?.n,0);}finally{migrated.close();}
  const path=`/cost-periods/${f.period.id}/expenses/${f.expense.id}/stock-receipts`;let r=await f.send(path,receiptInput(f));assert.equal(r.status,200);
  r=await f.send(`/cost-stock-receipts/${r.body.receipt.id}/reverse`,{itemVersion:2,effectiveDate:"2026-10-28",reason:"Synthetic correction",confirmFinanceUnchanged:true});assert.equal(r.status,200);
  r=await f.send(path,{...receiptInput(f),itemVersion:3,quantity:"0.2"});assert.equal(r.status,200);
  const tables=["cost_expenses","cost_periods","cost_stock_receipts","stock_movements","stock_events"],bytes=Object.fromEntries(tables.map(t=>[t,f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])),file=join(dir,"source.sqlite");await backup(f.db,file);await createBackup(file,join(dir,"bundle"));const restored=await restoreBackup(join(dir,"bundle"),join(dir,"restored")),db=new DatabaseSync(restored.databasePath);
  try{assert.equal(db.prepare("PRAGMA user_version").get()?.user_version,CURRENT_SCHEMA_VERSION);for(const t of tables)assert.deepEqual(db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),bytes[t]);assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);}finally{db.close();}
 }finally{f.db.close();await rm(dir,{recursive:true,force:true});}
});
test("legacy unlinked finance command receipt replays after later stock linkage without new finance write",async()=>{
 const f=await fixture();try{
  const path=`/cost-periods/${f.period.id}/expenses/${f.expense.id}`,key=randomUUID(),command={version:f.period.version,reason:"Before stock link",expense:{categoryId:f.expense.category_id,spendDate:f.expense.spend_date,description:"Actual pre-link edit",quantity:"99",unitPriceWon:"2"}};
  const original=await f.send(path,command,key,"put");assert.equal(original.status,200);
  let r=await f.send(path+"/stock-receipts",{...receiptInput(f),periodVersion:original.body.period.version,expenseVersion:original.body.expense.version});assert.equal(r.status,200);
  const rows=f.db.prepare("SELECT * FROM cost_expenses").all(),events=f.db.prepare("SELECT * FROM cost_events ORDER BY id").all();
  r=await f.send(path,command,key,"put");assert.equal(r.status,200);assert.deepEqual(r.body,original.body);assert.deepEqual(f.db.prepare("SELECT * FROM cost_expenses").all(),rows);assert.deepEqual(f.db.prepare("SELECT * FROM cost_events ORDER BY id").all(),events);assert.equal((await f.agent.get(f.base+`/stock-items/${f.item.id}`)).body.balance,"0.3");
 }finally{f.db.close();}
});
