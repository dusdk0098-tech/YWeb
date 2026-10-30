import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { openDatabase } from "../server/db.js";
import { createBackup, restoreBackup } from "../scripts/local-backup.js";
import { journalHash } from "../server/daily-journal-sources.js";
import { stockItem, movementHash, type StockMovement } from "../server/stock-model.js";
import { printStock } from "../server/stock-print.js";
import { minimumComparison, type StockMinimumSnapshot } from "../server/stock-minimum-model.js";
test("45 to46 keeps stock movement/event/receipt/print bytes and restores separate minimum history", async () => {
 const dir=await mkdtemp(join(tmpdir(),"pedit-minimum-")), file=join(dir,"old.sqlite"), db=openDatabase(file);
 const site=randomUUID(),user=randomUUID(),id=randomUUID();
 try {
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(user,"minimum@example.test","합성","not-login");
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site,"합성");
  db.prepare("INSERT INTO stock_items VALUES(?,?,?,?,1,?,?,?)").run(id,site,"합성 품목","개",user,"then","then");
  const body:Omit<StockMovement,"hash">={id:randomUUID(),item_id:id,sequence:1,kind:"opening",quantity:"0.1",direction:1,effective_date:"2026-10-28",reason:"합성",reverses_id:null,actor_id:user,actor_name:"합성",recorded_at:"then",item_snapshot:JSON.stringify({id,siteId:site,name:"합성 품목",unit:"개"}),balance_after:"0.1"};
  const move={...body,hash:movementHash(body)};
  db.prepare("INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(...Object.values(move));
  db.prepare("INSERT INTO stock_events(item_id,version,event,actor_id,actor_name,at,reason,data) VALUES(?,1,'create',?,'합성','then','합성',?)").run(id,user,'{"legacy":"keep exact"}');
  db.prepare("INSERT INTO idempotency VALUES(?,?,?,?,?)").run(user,"stock:create:"+site,randomUUID(),'{"name":"legacy","unit":"개"}','{"legacy":true}');
  const tables=["stock_items","stock_movements","stock_events","idempotency","cost_stock_receipts","ppe_issues","ppe_return_entries"],
   before=Object.fromEntries(tables.map(t=>[t,db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])), html=printStock(stockItem(db,site,id),[move],"0.1");
  db.exec("DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE stock_minimum_events; PRAGMA user_version=45");db.close();
  const upgraded=openDatabase(file);
  try {
   assert.equal(upgraded.prepare("PRAGMA user_version").get()!.user_version,CURRENT_SCHEMA_VERSION);
   for(const t of tables)assert.deepEqual(upgraded.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),before[t]);
   assert.equal(printStock(stockItem(upgraded,site,id),[move],"0.1"),html);
   assert.equal(minimumComparison(upgraded,stockItem(upgraded,site,id)).status,"unset");
   const s:StockMinimumSnapshot={schemaVersion:1,id:randomUUID(),version:1,item:{id,siteId:site,name:"合成",unit:"개",version:1},enabled:true,minimum:"0.3",reason:"합성 기준",actor:{id:user,name:"합성"},at:"now"};
   upgraded.prepare("INSERT INTO stock_minimum_events VALUES(?,?,?,?,?)").run(s.id,id,1,JSON.stringify(s),journalHash(s));
   const setting=upgraded.prepare("SELECT * FROM stock_minimum_events").all();
   assert.equal(minimumComparison(upgraded,stockItem(upgraded,site,id)).shortfall,"0.2");
   const current=join(dir,"current.sqlite");await backup(upgraded,current);await createBackup(current,join(dir,"bundle"));
   const result=await restoreBackup(join(dir,"bundle"),join(dir,"fresh")),restored=new DatabaseSync(result.databasePath);
   try {assert.deepEqual(restored.prepare("SELECT * FROM stock_minimum_events").all(),setting);assert.equal(restored.prepare("PRAGMA user_version").get()!.user_version,CURRENT_SCHEMA_VERSION);assert.deepEqual(restored.prepare("PRAGMA foreign_key_check").all(),[]);for(const t of tables)assert.deepEqual(restored.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),before[t]);}
   finally {restored.close();}
  } finally {upgraded.close();}
 } finally {if(db.isOpen)db.close();await rm(dir,{recursive:true,force:true});}
});
