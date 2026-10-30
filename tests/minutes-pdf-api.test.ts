import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {methodFixture} from './fixtures/risk-method-fixture.js';
import {attachmentUsage} from '../server/attachment-quota.js';
import {migrateMinutesAttachments} from '../server/minutes-attachment-schema.js';
import {openDatabase} from '../server/db.js';
import {printFinalMinutes} from '../server/minutes-print.js';
import {minutesRecord,minutesRow} from '../server/minutes-model.js';
import {createBackup,restoreBackup} from '../scripts/local-backup.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {backup,DatabaseSync} from 'node:sqlite';
import { tooLargeStatus } from "./fixtures/too-large.js";
const body={title:'Synthetic PDF originals',type:'안전보건협의체',date:'2026-10-28',time:'09:00',location:'Synthetic',attendees:'Synthetic',agenda:'Text',discussion:'Text',decisions:'Text',actions:[]};
const pdf=Buffer.from('%PDF-2.0\nSynthetic nonparsed original. Not a structurally valid PDF.'),png=Buffer.from([137,80,78,71,13,10,26,10,0]);
async function fixture(){const f=await methodFixture(),csrf=(await f.agent.get('/api/session')).body.csrf;
 const upload=(id:string,version:number,bytes=pdf,name='synthetic.pdf',format='application/pdf',key=randomUUID())=>f.agent.post(f.base+`/minutes/${id}/attachments`).set('Origin','http://127.0.0.1:3000').set('x-csrf-token',csrf).set('content-type','application/octet-stream').set('x-minutes-version',String(version)).set('x-file-name',encodeURIComponent(name)).set('x-file-type',format).set('idempotency-key',key).send(bytes);
 return {...f,csrf,upload};}
test('meeting PDF original has same retained quota, replay, download-only headers and fixed manifest; hazard PDF remains denied',async()=>{
 const f=await fixture();try{
 let m=(await f.send('post','/minutes',body)).body;const key=randomUUID();let r=await f.upload(m.id,m.version,pdf,'<synthetic>.PDF','application/pdf',key);assert.equal(r.status,200,r.text);const first=r.body.attachments[0],response=r.body;
 assert.deepEqual((await f.upload(m.id,m.version,pdf,'<synthetic>.PDF','application/pdf',key)).body,response);m=r.body.record;
 assert.equal((await f.upload(m.id,m.version,Buffer.from('%PDF-2.0'),'bad.pdf')).status,400);
 assert.equal((await f.upload(m.id,m.version,pdf,'wrong.png')).status,400);
 assert.equal((await tooLargeStatus(f.upload(m.id,m.version,Buffer.alloc(5*1024*1024+1),'big.pdf'))),413);
 r=await f.upload(m.id,m.version,png,'old.png','image/png');assert.equal(r.status,200);m=r.body.record;
 assert.deepEqual(attachmentUsage(f.db,f.site,m.id,'minutes'),{reportCount:2,siteCount:2,siteBytes:pdf.length+png.length,totalBytes:pdf.length+png.length});
 r=await f.send('post',`/minutes/${m.id}/attachments/${first.id}/state`,{version:m.version,attached:false,reason:'Retain original but remove from current list'});assert.equal(r.status,200);m=r.body.record;
 const down=await f.agent.get(f.base+`/minutes/${m.id}/attachments/${first.id}/download`);assert.equal(down.status,200);assert.deepEqual(down.body,pdf);assert.equal(down.headers['cache-control'],'no-store');assert.equal(down.headers['x-content-type-options'],'nosniff');assert.equal(down.headers['x-attachment-scan'],'UNSCANNED');assert.match(down.headers['content-disposition'],/^attachment;/);assert.match(down.headers['content-type'],/^application\/octet-stream/);
 r=await f.send('post',`/minutes/${m.id}/attachments/${first.id}/state`,{version:m.version,attached:true,reason:'Reconnect explicit original'});assert.equal(r.status,200);m=r.body.record;
 r=await f.send('post',`/minutes/${m.id}/finalize`,{version:m.version,confirmRecordOnly:true});assert.equal(r.status,200);m=r.body;
 assert.equal(m.snapshot.body.schemaVersion,2);assert.equal(m.snapshot.body.attachments.find((a:{id:string})=>a.id===first.id).format,'application/pdf');assert.equal(first.sha256,createHash('sha256').update(pdf).digest('hex'));
 const html=(await f.agent.get(f.base+`/minutes/${m.id}/print`)).text;assert.ok(html.includes('&lt;synthetic&gt;.PDF'));assert.ok(html.includes(first.sha256));assert.doesNotMatch(html,/<(?:iframe|embed|object|img)\b/);
 assert.equal((await f.upload(m.id,1,pdf,'<synthetic>.PDF','application/pdf',key)).status,409);
 r=await f.reviewSend(`/minutes/${m.id}/revise`,{version:m.version,reason:'New independent correction'});assert.equal(r.status,200);const corrected=r.body;assert.deepEqual((await f.agent.get(f.base+`/minutes/${corrected.id}/attachments`)).body,[]);
 f.db.prepare("UPDATE memberships SET role='viewer' WHERE user_id=? AND site_id=?").run(f.manager,f.site);assert.equal((await f.upload(corrected.id,corrected.version)).status,403);assert.deepEqual((await f.agent.get(f.base+`/minutes/${m.id}/attachments/${first.id}/download`)).body,pdf);
 f.db.prepare("UPDATE memberships SET role='manager' WHERE user_id=? AND site_id=?").run(f.manager,f.site);
 const report=randomUUID();f.db.prepare("INSERT INTO hazard_reports(id,site_id,owner_id,body,status,created_at,updated_at) VALUES(?,?,?,'{}','draft','now','now')").run(report,f.site,f.manager);
 const denied=await f.agent.post(f.base+`/hazards/${report}/attachments`).set('Origin','http://127.0.0.1:3000').set('x-csrf-token',f.csrf).set('content-type','application/octet-stream').set('x-hazard-version','1').set('x-file-name','synthetic.pdf').set('x-file-type','application/pdf').set('idempotency-key',randomUUID()).send(pdf);assert.equal(denied.status,400,denied.text);
 }finally{f.db.close();}
});
test('actual41 originals/events/receipts/final schema2 and HTML survive42 migration and mixed PDF backup restore',async()=>{
 const f=await fixture(),dir=await mkdtemp(join(tmpdir(),'minutes-pdf-'));try{
 // Reconstruct the exact legacy two-table schema before creating any originals.
 f.db.exec('DROP TABLE minutes_attachment_events; DROP TABLE minutes_attachments');migrateMinutesAttachments(f.db);
 let m=(await f.send('post','/minutes',body)).body;let r=await f.upload(m.id,m.version,png,'old.png','image/png');assert.equal(r.status,200);m=r.body.record;r=await f.send('post',`/minutes/${m.id}/finalize`,{version:m.version,confirmRecordOnly:true});assert.equal(r.status,200);m=r.body;
 const html=(await f.agent.get(f.base+`/minutes/${m.id}/print`)).text;
 const tables=['minutes','minutes_records','minutes_snapshots','minutes_attachments','minutes_attachment_events','idempotency'];const rows=Object.fromEntries(tables.map(t=>[t,f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
 const file=join(dir,'legacy.sqlite');await backup(f.db,file);const oldFile=new DatabaseSync(file);oldFile.exec('DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE work_plan_attachment_events; DROP TABLE work_plan_attachments');oldFile.close();const migrated=openDatabase(file);try{
 assert.equal(migrated.prepare('PRAGMA user_version').get()!.user_version,CURRENT_SCHEMA_VERSION);assert.equal(migrated.prepare('PRAGMA foreign_keys').get()!.foreign_keys,1);assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(),[]);
 for(const t of tables)assert.deepEqual(migrated.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),rows[t]);
 assert.equal(printFinalMinutes(minutesRecord(migrated,minutesRow(migrated,f.site,m.id)).snapshot!),html);
 assert.throws(()=>migrated.exec("UPDATE minutes_attachments SET sha256='x'"));assert.throws(()=>migrated.exec('UPDATE minutes_attachments SET attached=0'));assert.throws(()=>migrated.exec('DELETE FROM minutes_attachment_events'));
 }finally{migrated.close();}
 // Move the same live fixture forward, then create a new PDF original via the actual route.
 const {migrateMinutesPdf}=await import('../server/minutes-pdf-schema.js');migrateMinutesPdf(f.db);f.db.exec(`PRAGMA user_version=${CURRENT_SCHEMA_VERSION}`);
 let n=(await f.send('post','/minutes',body)).body;r=await f.upload(n.id,n.version);assert.equal(r.status,200);n=r.body.record;r=await f.send('post',`/minutes/${n.id}/finalize`,{version:n.version,confirmRecordOnly:true});assert.equal(r.status,200);
 const all=Object.fromEntries(tables.map(t=>[t,f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])),current=join(dir,'current.sqlite');await backup(f.db,current);await createBackup(current,join(dir,'bundle'));const restored=await restoreBackup(join(dir,'bundle'),join(dir,'restored')),db=new DatabaseSync(restored.databasePath);try{
 assert.equal(db.prepare('PRAGMA user_version').get()!.user_version,CURRENT_SCHEMA_VERSION);for(const t of tables)assert.deepEqual(db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),all[t]);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
 assert.equal((await f.agent.get(f.base+`/minutes/${m.id}/print`)).text,html);
 }finally{f.db.close();await rm(dir,{recursive:true,force:true});}
});
