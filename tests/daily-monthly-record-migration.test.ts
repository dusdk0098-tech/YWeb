import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync, backup } from "node:sqlite";
import { openDatabase } from "../server/db.js";
import { readMonthlyJournals } from "../server/daily-monthly-report.js";
import { journalHash } from "../server/daily-journal-sources.js";
import { printMonthlyJournals } from "../server/daily-monthly-print.js";
import { serializeMonthlyRecord, fixedMonthlyRecord, type MonthlyRecordBody } from "../server/daily-monthly-record-model.js";
import { printMonthlyRecord } from "../server/daily-monthly-record-print.js";
import { createBackup, restoreBackup } from "../scripts/local-backup.js";
import type { DailySnapshot } from "../server/daily-journal-model.js";
test("schema43 journal bytes remain exact in44; immutable monthly records survive backup with prior attachment domains",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"pedit-monthly-migration-")),file=join(dir,"old.sqlite");
 let db=openDatabase(file);
 try {
  db.exec("INSERT INTO users VALUES('u','u@example.test','Original name','synthetic-hash');INSERT INTO sites(id,name) VALUES('s','Original site');");
  const facts={siteId:"s",date:"2026-10-01",attendance:{presentWorkers:0,presentVisitors:0,cancelledRecords:0,totalRecords:0,revisionHash:"synthetic"},tbm:[]};
  const body={workSummary:"Historical work",workLocations:"Historical place",safetyInstructions:"Manual note",observations:"",followupNotes:"",patrols:[]};
  const source={facts,fingerprint:journalHash(facts),capturedAt:"2026-10-01T00:00:00Z",capturedBy:{id:"u",name:"Original name"}};
  const snapshot:DailySnapshot={id:"j",date:facts.date,version:3,site:{id:"s",name:"Original site"},author:{id:"u",name:"Original name"},parentId:null,revisionReason:"",body,source,archivedBy:{id:"u",name:"Original name"},archivedAt:"2026-10-01T00:00:00Z"};
  db.prepare("INSERT INTO daily_journals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run("j","s",facts.date,JSON.stringify(body),"archived",3,"u",null,"",JSON.stringify(source),source.capturedAt,source.capturedAt);
  db.prepare("INSERT INTO daily_journal_snapshots VALUES(?,?,?)").run("j",JSON.stringify(snapshot),journalHash(snapshot));
  const original=db.prepare("SELECT * FROM daily_journal_snapshots").all();
  const before=readMonthlyJournals(db,"s","2026-10"),oldHtml=printMonthlyJournals(before);
  db.exec("DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE daily_monthly_records;PRAGMA user_version=43");db.close();
  db=openDatabase(file);assert.equal(db.prepare("PRAGMA user_version").get()?.user_version,CURRENT_SCHEMA_VERSION);
  assert.deepEqual(db.prepare("SELECT * FROM daily_journal_snapshots").all(),original);
  const after=readMonthlyJournals(db,"s","2026-10");assert.equal(after.fingerprint,before.fingerprint);assert.equal(printMonthlyJournals({...after,generatedAt:before.generatedAt}),oldHtml);
  const id=randomUUID(),record:MonthlyRecordBody={schema:1,id,number:1,parentId:null,parentHash:null,report:after,actor:{id:"u",name:"Original name"},recordedAt:"2026-10-28T00:00:00Z",reason:"Synthetic fixed view",kind:"saved-month-view-not-approval"};
  db.prepare("INSERT INTO daily_monthly_records VALUES(?,?,?,?,?,?,?,?)").run(id,"s","2026-10",1,null,JSON.stringify(record),journalHash(record),record.recordedAt);
  const fixed=fixedMonthlyRecord(db,"s",id),html=printMonthlyRecord(fixed);
  const current=join(dir,"current.sqlite");await backup(db,current);const manifest=await createBackup(current,join(dir,"bundle"));assert.equal(manifest.counts.daily_monthly_records,1);
  const restored=await restoreBackup(join(dir,"bundle"),join(dir,"restore")),check=new DatabaseSync(restored.databasePath);
  try {
   assert.equal(check.prepare("PRAGMA user_version").get()?.user_version,CURRENT_SCHEMA_VERSION);
   assert.deepEqual(check.prepare("SELECT * FROM daily_journal_snapshots").all(),original);
   assert.equal(printMonthlyRecord(fixedMonthlyRecord(check,"s",id)),html);
   for(const table of ["hazard_attachments","minutes_attachments","work_plan_attachments"])assert.equal(check.prepare(`SELECT count(*) n FROM ${table}`).get()?.n,0);
   assert.deepEqual(check.prepare("PRAGMA foreign_key_check").all(),[]);
  }finally{check.close();}
 }finally{try{db.close();}catch{/* already closed */}await rm(dir,{recursive:true,force:true});}
});

test("monthly record serialization accepts exact4MiB and rejects one extra UTF8 byte whole",()=>{
 const db=openDatabase(":memory:");try {
  db.prepare("INSERT INTO sites(id,name) VALUES('s','site')").run();
  const body:MonthlyRecordBody={schema:1,id:randomUUID(),number:1,parentId:null,parentHash:null,report:readMonthlyJournals(db,"s","2026-10"),actor:{id:"u",name:"synthetic"},recordedAt:"2026-10-28T00:00:00Z",reason:"",kind:"saved-month-view-not-approval"};
  // Synthetic serializer boundary, not a bypass of the public reason1000 limit.
  const room=4*1024*1024-Buffer.byteLength(JSON.stringify(body));
  body.reason="x".repeat(room);assert.equal(Buffer.byteLength(serializeMonthlyRecord(body)),4*1024*1024);
  body.reason+="x";assert.throws(()=>serializeMonthlyRecord(body),/4MiB/);
 }finally{db.close();}
});
