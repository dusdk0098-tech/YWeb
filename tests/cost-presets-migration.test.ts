import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync,backup } from "node:sqlite";
import { openDatabase } from "../server/db.js";
import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import { costExpenses,costTotals,getCostPeriod,type CostSnapshot } from "../server/cost-model.js";
import { journalHash } from "../server/daily-journal-sources.js";
import { printCostPeriod } from "../server/cost-print.js";
import { readCostPreset,saveExpensePresetSource,readExpensePresetSource,type PresetBody } from "../server/cost-preset-model.js";
import { createBackup,restoreBackup } from "../scripts/local-backup.js";
test("schema46 expenses/closure/receipts stay exact through47 and source sidecar survives synthetic backup",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"pedit-preset-migration-")),file=join(dir,"old.sqlite");let db=openDatabase(file);
 try {
  db.exec("INSERT INTO users VALUES('u','u@example.test','Synthetic','hash');INSERT INTO sites(id,name) VALUES('s','Site');");
  const categories=[{id:"c",label:"Old category",plan:"10",opening:"0"}];
  db.prepare("INSERT INTO cost_periods VALUES('p','s','2026-10',?,'Old note','open',1,NULL,NULL,NULL,'u','t','t')").run(JSON.stringify(categories));
  db.exec("INSERT INTO cost_expenses VALUES('e','p','c','2026-10-28','Old expense','1','2','2','active',1,'u','t','t')");
  const expense=costExpenses(db,"p")[0],period=getCostPeriod(db,"s","p"),snapshot:CostSnapshot={schema:1,id:"close",number:1,site:{id:"s",name:"Site"},period:{...period,categories,status:"closed",version:2,current_close_id:"close"},totals:costTotals(categories,[expense]),expenses:[expense],closedBy:{id:"u",name:"Synthetic"},closedAt:"t",reason:"Old close",policy:"exact-six-decimal-whole-won-price-v1"};
  const text=JSON.stringify(snapshot),hash=journalHash(snapshot);db.prepare("INSERT INTO cost_closures VALUES('close','p',1,?,?,'t')").run(text,hash);db.exec("UPDATE cost_periods SET status='closed',version=2,current_close_id='close' WHERE id='p'");
  const request='{"version":1,"expense":{"categoryId":"c","spendDate":"2026-10-28","description":"Old expense","quantity":"1","unitPriceWon":"2","amount":"2"}}';
  db.prepare("INSERT INTO idempotency VALUES('u','legacy','key',?,?)").run(request,'{"legacy":true}');
  const oldExpense=db.prepare("SELECT * FROM cost_expenses").all(),oldClosure=db.prepare("SELECT * FROM cost_closures").all(),oldReceipt=db.prepare("SELECT * FROM idempotency").all(),html=printCostPeriod(snapshot,hash);
  db.exec("DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE cost_expense_preset_sources;DROP TABLE cost_input_presets;PRAGMA user_version=46");db.close();db=openDatabase(file);
  assert.equal(db.prepare("PRAGMA user_version").get()?.user_version,CURRENT_SCHEMA_VERSION);assert.deepEqual(db.prepare("SELECT * FROM cost_expenses").all(),oldExpense);assert.deepEqual(db.prepare("SELECT * FROM cost_closures").all(),oldClosure);assert.deepEqual(db.prepare("SELECT * FROM idempotency").all(),oldReceipt);assert.equal(printCostPeriod(JSON.parse(String(oldClosure[0].body)),String(oldClosure[0].hash)),html);assert.equal(readExpensePresetSource(db,"s","p","e"),null);
  // Separate synthetic source fixture; not retroactive application to the legacy row.
  db.prepare("INSERT INTO cost_periods VALUES('new','s','2026-11',?,'Synthetic','open',1,NULL,NULL,NULL,'u','t','t')").run(JSON.stringify(categories));db.exec("INSERT INTO cost_expenses VALUES('new-e','new','c','2026-11-01','New expense','1','2','2','active',1,'u','t','t')");
  const id=randomUUID(),body:PresetBody={schema:1,id,rootId:id,parentId:null,parentHash:null,version:1,status:"active",name:"Synthetic default",defaults:{description:"New expense",quantity:"1",unitPriceWon:"2"},reason:"New",actor:{id:"u",name:"Synthetic"},at:"t"};db.prepare("INSERT INTO cost_input_presets VALUES(?,'s',?,NULL,1,'active',?,?,'t')").run(id,id,JSON.stringify(body),journalHash(body));
  const source=saveExpensePresetSource(db,"s",costExpenses(db,"new")[0],readCostPreset(db,"s",id),"t");assert.equal(source.body.editedAtCreation,false);
  const current=join(dir,"current.sqlite");await backup(db,current);const manifest=await createBackup(current,join(dir,"bundle"));assert.equal(manifest.counts.cost_input_presets,1);assert.equal(manifest.counts.cost_expense_preset_sources,1);
  const restored=await restoreBackup(join(dir,"bundle"),join(dir,"restore")),copy=new DatabaseSync(restored.databasePath);try{assert.equal(copy.prepare("PRAGMA user_version").get()?.user_version,CURRENT_SCHEMA_VERSION);assert.deepEqual(readExpensePresetSource(copy,"s","new","new-e")?.body,source.body);assert.deepEqual(copy.prepare("SELECT * FROM cost_closures").all(),oldClosure);assert.deepEqual(copy.prepare("SELECT * FROM idempotency").all(),oldReceipt);assert.equal(readExpensePresetSource(copy,"s","p","e"),null);assert.deepEqual(copy.prepare("PRAGMA foreign_key_check").all(),[]);}finally{copy.close();}
 }finally{try{db.close();}catch{/*already closed*/}await rm(dir,{recursive:true,force:true});}
});
