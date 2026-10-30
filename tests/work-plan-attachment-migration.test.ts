import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {backup,DatabaseSync} from 'node:sqlite';
import {methodFixture} from './fixtures/risk-method-fixture.js';
import {openDatabase} from '../server/db.js';
import {createBackup,restoreBackup} from '../scripts/local-backup.js';
import {journalHash} from '../server/daily-journal-sources.js';
import {fullWorkPlan,getWorkPlan,type WorkPlanSnapshot} from '../server/work-plan-model.js';
import {printWorkPlan} from '../server/work-plan-print.js';
import {printLegacyWorkPlan} from './fixtures/work-plan-print-legacy.js';
const body={title:'Synthetic legacy plan',date:'2026-10-28',startTime:'09:00',endTime:'10:00',location:'Synthetic',workDescription:'Synthetic',emergencyProcedure:'Synthetic',verificationNote:'Text',steps:[{task:'Task',procedure:'Procedure',precaution:'Precaution'}],equipmentIds:[],duties:[]};
test('schema42 legacy archive/submission JSON hashes receipts and HTML stay exact;43 backup restores all three original tables',async()=>{
 const f=await methodFixture(),dir=await mkdtemp(join(tmpdir(),'work-plan-attachments-'));try{
 const legacy:{id:string;html:string}[]=[];
 for(const submitted of [false,true]){
 let r=await f.send('post','/work-plans',{body});r=await f.send('post',`/work-plans/${r.body.id}/capture`,{version:1});assert.equal(r.status,200);const p=r.body,at='2026-10-28T00:00:00.000Z';
 // Explicit old shape: these fixed fixtures deliberately predate any attachmentManifest field.
 const snapshot:WorkPlanSnapshot={...(submitted?{recordKind:'author_submission' as const}:{}),id:p.id,version:p.version+1,site:{id:f.site,name:'Synthetic site'},author:{id:f.manager,name:'Synthetic'},parentId:null,revisionReason:'',body:p.body,source:p.source_capture,archivedBy:{id:f.manager,name:'Synthetic'},archivedAt:at};
 f.db.prepare("UPDATE work_plans SET status='archived',version=version+1,updated_at=? WHERE id=?").run(at,p.id);f.db.prepare('INSERT INTO work_plan_snapshots VALUES(?,?,?)').run(p.id,JSON.stringify(snapshot),journalHash(snapshot));if(submitted)f.db.prepare("INSERT INTO work_plan_document_reviews VALUES(?,?,'submitted',1,NULL,?)").run(p.id,journalHash(snapshot),at);
 const html=(await f.agent.get(f.base+`/work-plans/${p.id}/print`)).text;assert.equal(html,printLegacyWorkPlan(snapshot,journalHash(snapshot)));legacy.push({id:p.id,html});
 }
 const tables=['work_plans','work_plan_snapshots','work_plan_events','work_plan_document_reviews','work_plan_review_events','idempotency'];const before=Object.fromEntries(tables.map(t=>[t,f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
 const file=join(dir,'old.sqlite');await backup(f.db,file);const old=new DatabaseSync(file);old.exec('DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE work_plan_attachment_events;DROP TABLE work_plan_attachments;PRAGMA user_version=42');old.close();
 const migrated=openDatabase(file);try{assert.equal(migrated.prepare('PRAGMA user_version').get()!.user_version,CURRENT_SCHEMA_VERSION);for(const t of tables)assert.deepEqual(migrated.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),before[t]);for(const item of legacy){const snap=fullWorkPlan(migrated,getWorkPlan(migrated,f.site,item.id)).snapshot!;assert.equal(snap.body.attachmentManifest,undefined);assert.equal(printWorkPlan(snap.body,snap.hash),item.html);}assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(),[]);}finally{migrated.close();}
 const csrf=(await f.agent.get('/api/session')).body.csrf,pdf=Buffer.from('%PDF-2.0\nSynthetic original'),png=Buffer.from([137,80,78,71,13,10,26,10,0]);let p=(await f.send('post','/work-plans',{body})).body;
 let r=await f.agent.post(f.base+`/work-plans/${p.id}/attachments`).set('Origin','http://127.0.0.1:3000').set('x-csrf-token',csrf).set('content-type','application/octet-stream').set('x-work-plan-version',String(p.version)).set('x-file-name','new.pdf').set('x-file-type','application/pdf').set('idempotency-key',randomUUID()).send(pdf);assert.equal(r.status,200,r.text);p=r.body.record;r=await f.send('post',`/work-plans/${p.id}/capture`,{version:p.version});assert.equal(r.status,200);p=r.body.record||r.body;r=await f.send('post',`/work-plans/${p.id}/submit`,{version:p.version,reason:'New manifest',confirmDocumentOnly:true});assert.equal(r.status,200,r.text);
 const m=(await f.send('post','/minutes',{title:'Synthetic',type:'기타',date:'2026-10-28',time:'09:00',location:'S',attendees:'S',agenda:'S',discussion:'S',decisions:'S',actions:[]})).body;f.db.prepare("INSERT INTO minutes_attachments VALUES(?,?,?,'m.pdf','application/pdf',?,?,?,0,?,'now')").run(randomUUID(),f.site,m.id,pdf.length,createHash('sha256').update(pdf).digest('hex'),pdf,f.manager);
 const h=randomUUID();f.db.prepare("INSERT INTO hazard_reports(id,site_id,owner_id,body,status,created_at,updated_at) VALUES(?,?,?,'{}','draft','now','now')").run(h,f.site,f.manager);f.db.prepare("INSERT INTO hazard_attachments VALUES(?,?,?,'h.png','image/png',?,?,?,0,?,'now')").run(randomUUID(),f.site,h,png.length,createHash('sha256').update(png).digest('hex'),png,f.manager);
 const allTables=[...tables,'work_plan_attachments','work_plan_attachment_events','minutes_attachments','minutes_attachment_events','hazard_attachments'],rows=Object.fromEntries(allTables.map(t=>[t,f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])),current=join(dir,'current.sqlite');await backup(f.db,current);await createBackup(current,join(dir,'bundle'));const restored=await restoreBackup(join(dir,'bundle'),join(dir,'restored')),db=new DatabaseSync(restored.databasePath);try{assert.equal(db.prepare('PRAGMA user_version').get()!.user_version,CURRENT_SCHEMA_VERSION);for(const t of allTables)assert.deepEqual(db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),rows[t]);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);for(const t of ['work_plan_attachments','minutes_attachments','hazard_attachments']){const a=db.prepare(`SELECT bytes,sha256 FROM ${t} LIMIT 1`).get()!;assert.equal(createHash('sha256').update(a.bytes as Uint8Array).digest('hex'),a.sha256);}}finally{db.close();}
 }finally{f.db.close();await rm(dir,{recursive:true,force:true});}
});
