import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { backup, DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { openDatabase } from "../server/db.js";
import { createBackup, restoreBackup } from "../scripts/local-backup.js";
import { fixedCostEvidence } from "../server/cost-evidence-model.js";
import { baselineView } from "../server/cost-baseline-model.js";
import { costEvidenceFixture } from "./fixtures/cost-evidence-fixture.js";
test("47 to48 leaves old no-manifest financial closure/baseline/receipt bytes untouched; new raw evidence survives backup",async()=>{
 const f=await costEvidenceFixture(),dir=await mkdtemp(join(tmpdir(),"pedit-cost-evidence-"));try{
  const expense=await f.expense();let r=await f.close();assert.equal(r.status,200);const p=r.body,closureId=p.current_close_id;
  r=await f.send(f.base+"/baselines",{version:p.version,closureId,closureHash:p.currentClosure.hash,memo:"합성 고정 금융 기준본"});assert.equal(r.status,200,r.text);const baselineId=r.body.id;
  const tables=["cost_periods","cost_expenses","cost_events","cost_closures","cost_baselines","idempotency"],before=Object.fromEntries(tables.map(t=>[t,f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])),legacy=join(dir,"old.sqlite");await backup(f.db,legacy);
  const old=new DatabaseSync(legacy);old.exec("DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE cost_close_evidence;DROP TABLE cost_evidence_events;DROP TABLE cost_evidence_links;DROP TABLE cost_evidence_files;PRAGMA user_version=47");old.close();
  const migrated=openDatabase(legacy);try{
   assert.equal(migrated.prepare("PRAGMA user_version").get()!.user_version,CURRENT_SCHEMA_VERSION);
   for(const t of tables)assert.deepEqual(migrated.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),before[t]);
   assert.equal(fixedCostEvidence(migrated,f.site,p.id,closureId).recorded,false);
   assert.equal(baselineView(migrated,f.site,p.id,baselineId).body.closureId,closureId);assert.deepEqual(migrated.prepare("PRAGMA foreign_key_check").all(),[]);
  }finally{migrated.close();}
  r=await f.send(f.base+"/reopen",{version:p.version,reason:"합성 신규 연결"});assert.equal(r.status,200);
  r=await f.upload();assert.equal(r.status,200);const file=r.body.items[0].file;
  const oldReceipt=f.db.prepare("SELECT key,request,response FROM idempotency WHERE scope=?").get(`cost:close:${f.site}:${p.id}`)!;
  const repeat=await f.send(f.base+"/close",JSON.parse(String(oldReceipt.request)),String(oldReceipt.key));assert.equal(repeat.status,200);assert.equal(JSON.stringify(repeat.body),String(oldReceipt.response));assert.equal((await f.current()).status,"open");
  assert.equal((await f.links(file.id,[{expenseId:expense.id,version:expense.version}])).status,200);r=await f.close();assert.equal(r.status,200);const newId=r.body.current_close_id;
  const all=[...tables,"cost_evidence_files","cost_evidence_links","cost_evidence_events","cost_close_evidence"],rows=Object.fromEntries(all.map(t=>[t,f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])),current=join(dir,"current.sqlite");await backup(f.db,current);await createBackup(current,join(dir,"bundle"));
  const restored=await restoreBackup(join(dir,"bundle"),join(dir,"restored")),db=new DatabaseSync(restored.databasePath);try{
   assert.equal(db.prepare("PRAGMA user_version").get()!.user_version,CURRENT_SCHEMA_VERSION);for(const t of all)assert.deepEqual(db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),rows[t]);
   assert.equal(fixedCostEvidence(db,f.site,p.id,newId).recorded,true);const blob=db.prepare("SELECT bytes,sha256 FROM cost_evidence_files WHERE id=?").get(file.id)!;assert.equal(createHash("sha256").update(blob.bytes as Uint8Array).digest("hex"),blob.sha256);assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);
  }finally{db.close();}
 }finally{f.db.close();await rm(dir,{recursive:true,force:true});}
});
