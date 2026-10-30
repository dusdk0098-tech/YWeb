import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {methodFixture} from "./fixtures/risk-method-fixture.js";
import {attachmentUsage,enforceAttachmentQuota} from "../server/attachment-quota.js";
import {isMinutesUpload} from "../server/minutes-attachment-routes.js";
import {minutesHash,type MinutesSnapshot} from "../server/minutes-model.js";
import {printFinalMinutes} from "../server/minutes-print.js";
import {printLegacyFinalMinutes} from "./fixtures/minutes-print-schema1.js";
const body={title:'Synthetic <minutes>',type:'안전보건협의체',date:'2026-10-28',time:'09:00',location:'Synthetic room',attendees:'Synthetic attendees',agenda:'Agenda',discussion:'Discussion',decisions:'Decision',actions:[]};
const png=Buffer.from([137,80,78,71,13,10,26,10,0,1,2]),jpeg=Buffer.from([255,216,255,0,1,2]);
async function fixture(){const f=await methodFixture(),csrf=(await f.agent.get('/api/session')).body.csrf;const upload=(id:string,version:number,bytes=png,name='synthetic.png',type='image/png',key=randomUUID())=>f.agent.post(f.base+`/minutes/${id}/attachments`).set('Origin','http://127.0.0.1:3000').set('x-csrf-token',csrf).set('content-type','application/octet-stream').set('x-minutes-version',String(version)).set('x-file-name',encodeURIComponent(name)).set('x-file-type',type).set('idempotency-key',key).send(bytes);return {...f,upload};}
test('raw minutes matcher is exact including case and slash; old schema1 renderer remains byte-identical',()=>{
 assert.equal(isMinutesUpload('POST','/api/sites/s/minutes/m/attachments'),true);assert.equal(isMinutesUpload('POST','/API/SITES/s/MINUTES/m/ATTACHMENTS/'),true);assert.equal(isMinutesUpload('GET','/api/sites/s/minutes/m/attachments'),false);assert.equal(isMinutesUpload('POST','/api/sites/s/minutes/m/attachments/x/state'),false);
 const snapshot={schemaVersion:1,id:'old',site:{id:'s',name:'site'},author:{id:'u',name:'old name'},version:2,body:{...body,type:'안전보건협의체' as const},parentId:null,revisionReason:'',finalizedBy:{id:'u',name:'old manager'},finalizedAt:'2026-10-28T00:00:00Z'} satisfies MinutesSnapshot;
 const fixed={body:snapshot,hash:minutesHash(snapshot)};assert.equal(printFinalMinutes(fixed),printLegacyFinalMinutes(fixed));assert.ok(!printFinalMinutes(fixed).includes('확정 당시 연결 첨부'));
});
test('minutes originals upload detach reconnect fixed manifest download and no copy into correction',async()=>{
 const f=await fixture();try{
  let r=await f.send('post','/minutes',body);assert.equal(r.status,200);let m=r.body;const id=m.id;
  const key=randomUUID();r=await f.upload(id,m.version,png,'<synthetic>.png','image/png',key);assert.equal(r.status,200,r.text);const first=r.body.attachments[0];assert.equal(first.sha256,createHash('sha256').update(png).digest('hex'));const uploaded=r.body;
  assert.deepEqual((await f.upload(id,m.version,png,'<synthetic>.png','image/png',key)).body,uploaded);m=r.body.record;
  r=await f.upload(id,m.version,jpeg,'synthetic.jpg','image/jpeg');assert.equal(r.status,200);m=r.body.record;const second=r.body.attachments.find((a:{id:string})=>a.id!==first.id);
  r=await f.send('post',`/minutes/${id}/attachments/${first.id}/state`,{version:m.version,attached:false,reason:'Detached but retained'});assert.equal(r.status,200);m=r.body.record;
  assert.equal(attachmentUsage(f.db,f.site,id,'minutes').reportCount,2);
  let down=await f.agent.get(f.base+`/minutes/${id}/attachments/${first.id}/download`);assert.equal(down.status,200);assert.deepEqual(down.body,png);assert.match(down.headers['content-disposition'],/^attachment;/);assert.match(down.headers['content-type'],/application\/octet-stream/);assert.equal(down.headers['x-attachment-scan'],'UNSCANNED');assert.equal(down.headers['x-content-type-options'],'nosniff');
  r=await f.send('post',`/minutes/${id}/attachments/${first.id}/state`,{version:m.version,attached:true,reason:'Reconnect original'});assert.equal(r.status,200);m=r.body.record;
  r=await f.send('post',`/minutes/${id}/attachments/${second.id}/state`,{version:m.version,attached:false,reason:'Exclude from final manifest only'});assert.equal(r.status,200);m=r.body.record;
  r=await f.send('post',`/minutes/${id}/finalize`,{version:m.version,confirmRecordOnly:true});assert.equal(r.status,200,r.text);m=r.body;
  assert.equal(m.snapshot.body.schemaVersion,2);assert.equal(m.snapshot.body.attachments.length,1);assert.equal(m.snapshot.body.attachments[0].id,first.id);
  const snapshot=f.db.prepare('SELECT * FROM minutes_snapshots WHERE minutes_id=?').get(id),original=f.db.prepare('SELECT * FROM minutes_attachments WHERE id=?').get(first.id),html=(await f.agent.get(f.base+`/minutes/${id}/print`)).text;
  assert.ok(html.includes('&lt;synthetic&gt;.png'));assert.ok(html.includes(first.sha256));assert.ok(!html.includes('<img'));assert.ok(!html.includes('synthetic.jpg'));
  assert.equal((await f.upload(id,1,png,'<synthetic>.png','image/png',key)).status,409);
  assert.equal((await f.send('post',`/minutes/${id}/attachments/${first.id}/state`,{version:m.version,attached:false,reason:'must fail'})).status,409);
  r=await f.reviewSend(`/minutes/${id}/revise`,{version:m.version,reason:'New correction'});assert.equal(r.status,200);assert.deepEqual((await f.agent.get(f.base+`/minutes/${r.body.id}/attachments`)).body,[]);
  assert.deepEqual(f.db.prepare('SELECT * FROM minutes_snapshots WHERE minutes_id=?').get(id),snapshot);assert.deepEqual(f.db.prepare('SELECT * FROM minutes_attachments WHERE id=?').get(first.id),original);assert.equal((await f.agent.get(f.base+`/minutes/${id}/print`)).text,html);
  assert.throws(()=>f.db.prepare('UPDATE minutes_attachments SET attached=0 WHERE id=?').run(first.id),/immutable/);assert.throws(()=>f.db.prepare('DELETE FROM minutes_attachments WHERE id=?').run(first.id),/retained|Retained/);
  const events=await f.agent.get(f.base+`/minutes/${id}/attachments/events`);assert.equal(events.body.items.length,5);assert.ok(events.body.items.some((e:{reason:string})=>e.reason==='Detached but retained'));
  f.db.prepare("UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?").run(f.site,f.manager);
  down=await f.agent.get(f.base+`/minutes/${id}/attachments/${second.id}/download`);assert.equal(down.status,200);assert.deepEqual(down.body,jpeg);
 }finally{f.db.close();}
});
test('new minutes upload rejects unsupported originals and rolls back original plus version on event failure',async()=>{
 const f=await fixture();try{
  let r=await f.send('post','/minutes',body);const m=r.body;
  assert.equal((await f.upload(m.id,m.version,Buffer.from('%PDF-1.7'),'file.pdf','application/pdf')).status,400);
  assert.equal((await f.upload(m.id,m.version,png,'wrong.jpg','image/png')).status,400);assert.equal((await f.upload(m.id,m.version,Buffer.from('not png'))).status,400);assert.equal((await f.upload(m.id,m.version,png,'../bad.png')).status,400);
  const before=f.db.prepare('SELECT * FROM minutes WHERE id=?').get(m.id);
  f.db.exec("CREATE TRIGGER minutes_attach_test_abort BEFORE INSERT ON minutes_attachment_events BEGIN SELECT RAISE(ABORT,'ordinary event failure'); END;");
  r=await f.upload(m.id,m.version);assert.equal(r.status,500);assert.equal(f.db.prepare('SELECT count(*) n FROM minutes_attachments').get()!.n,0);assert.deepEqual(f.db.prepare('SELECT * FROM minutes WHERE id=?').get(m.id),before);f.db.exec('DROP TRIGGER minutes_attach_test_abort');
  r=await f.upload(m.id,m.version);assert.equal(r.status,200);assert.equal((await f.upload(m.id,m.version)).status,409);assert.equal(f.db.prepare('SELECT count(*) n FROM minutes_attachments').get()!.n,1);
 }finally{f.db.close();}
});
test('retained quotas combine minutes and hazard bytes/count while each document keeps its own count',async()=>{
 const f=await fixture();try{
  const m=(await f.send('post','/minutes',body)).body,report=randomUUID();
  f.db.prepare("INSERT INTO hazard_reports(id,site_id,owner_id,body,status,created_at,updated_at) VALUES(?,?,?,'{}','draft','now','now')").run(report,f.site,f.manager);
  f.db.prepare("INSERT INTO hazard_attachments VALUES(?,?,?,'a.png','image/png',?,'synthetic',?,0,?,'now')").run(randomUUID(),f.site,report,png.length,png,f.manager);
  const r=await f.upload(m.id,m.version);assert.equal(r.status,200);
  const usage=attachmentUsage(f.db,f.site,m.id,'minutes');assert.deepEqual(usage,{reportCount:1,siteCount:2,siteBytes:png.length*2,totalBytes:png.length*2});assert.equal(attachmentUsage(f.db,f.site,report).reportCount,1);
  const limits={reportCount:20,siteCount:200,siteBytes:png.length*3,totalBytes:png.length*3};enforceAttachmentQuota(usage,png.length,limits);assert.throws(()=>enforceAttachmentQuota(usage,png.length+1,limits),/한도/);
  let extraReport='';
  for(let i=0;i<198;i++){
   if(i%20===0){extraReport=randomUUID();f.db.prepare("INSERT INTO hazard_reports(id,site_id,owner_id,body,status,created_at,updated_at) VALUES(?,?,?,'{}','draft','now','now')").run(extraReport,f.site,f.manager);}
   f.db.prepare("INSERT INTO hazard_attachments VALUES(?,?,?,'a.png','image/png',?,'synthetic',?,0,?,'now')").run(randomUUID(),f.site,extraReport,png.length,png,f.manager);
  }
  assert.equal(attachmentUsage(f.db,f.site,m.id,'minutes').siteCount,200);
  assert.equal((await f.upload(m.id,r.body.record.version)).status,409);
  assert.equal(attachmentUsage(f.db,f.site,m.id,'minutes').siteCount,200);
 }finally{f.db.close();}
});
test('twenty mixed image/PDF retained originals include detached files; a twenty-first upload creates nothing',async()=>{
 const f=await fixture();try{
  let m=(await f.send('post','/minutes',body)).body;let first='';
  for(let n=0;n<20;n++){const r=await f.upload(m.id,m.version,n%2?Buffer.from("%PDF-1.7\nSynthetic"):png,`synthetic-${n}.${n%2?"pdf":"png"}`,n%2?"application/pdf":"image/png");assert.equal(r.status,200,r.text);m=r.body.record;if(!first)first=r.body.attachments[0].id;}
  let r=await f.send('post',`/minutes/${m.id}/attachments/${first}/state`,{version:m.version,attached:false,reason:'Retain and detach at capacity'});assert.equal(r.status,200);m=r.body.record;
  const before=f.db.prepare('SELECT * FROM minutes WHERE id=?').get(m.id);r=await f.upload(m.id,m.version);assert.equal(r.status,409,r.text);assert.equal(attachmentUsage(f.db,f.site,m.id,'minutes').reportCount,20);assert.deepEqual(f.db.prepare('SELECT * FROM minutes WHERE id=?').get(m.id),before);
 }finally{f.db.close();}
});
test('actual app shares exactly one bounded reader across the two original upload modules',async()=>{
 const {readFile}=await import('node:fs/promises');const source=await readFile(new URL('../server/app.ts',import.meta.url),'utf8');
 assert.equal((source.match(/=\s*boundedUploadReader\(\)/g)||[]).length,1);
 assert.match(source,/registerHazardAttachments\(app, db, \{ access, mutate \},attachmentReader\)/);
 assert.match(source,/registerMinutesAttachments\(app,db,\{access,mutate\},attachmentReader\)/);
 // Ordinary resource-wiring check, not an independent authorization audit.
 for(const file of ['hazard-attachments.ts','minutes-attachment-routes.ts'])assert.ok(!(await readFile(new URL('../server/'+file,import.meta.url),'utf8')).includes('= boundedUploadReader()'));
});
test('schema40 legacy schema1 snapshot and print stay unchanged; schema41 backup restores original BLOBs and fixed manifests',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{join}=await import('node:path'),{tmpdir}=await import('node:os'),{backup,DatabaseSync}=await import('node:sqlite'),{openDatabase}=await import('../server/db.js'),{createBackup,restoreBackup}=await import('../scripts/local-backup.js'),{meetingInput}=await import('../server/validation.js');
 const f=await fixture(),dir=await mkdtemp(join(tmpdir(),'minutes-attachments-'));try{
  const legacy=(await f.send('post','/minutes',body)).body,id=legacy.id,now='2026-10-28T12:00:00.000Z';
  const oldSnapshot:MinutesSnapshot={schemaVersion:1,id,site:{id:f.site,name:'Synthetic site'},author:{id:f.manager,name:'Synthetic'},version:2,body:meetingInput.parse(body),parentId:null,revisionReason:'',finalizedBy:{id:f.manager,name:'Synthetic'},finalizedAt:now};
  f.db.prepare('UPDATE minutes SET version=2,updated_at=? WHERE id=?').run(now,id);f.db.prepare("INSERT INTO minutes_records VALUES(?,'finalized',NULL,'')").run(id);f.db.prepare('INSERT INTO minutes_snapshots VALUES(?,?,?)').run(id,JSON.stringify(oldSnapshot),minutesHash(oldSnapshot));
  const snapshot=f.db.prepare('SELECT * FROM minutes_snapshots WHERE minutes_id=?').get(id),html=(await f.agent.get(f.base+`/minutes/${id}/print`)).text;assert.equal(html,printLegacyFinalMinutes({body:oldSnapshot,hash:minutesHash(oldSnapshot)}));
  const oldFile=join(dir,'old.sqlite');await backup(f.db,oldFile);const old=new DatabaseSync(oldFile);old.exec('DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE work_plan_attachment_events; DROP TABLE work_plan_attachments; DROP TABLE minutes_attachment_events; DROP TABLE minutes_attachments; PRAGMA user_version=40');old.close();
  const migrated=openDatabase(oldFile);try{assert.equal(migrated.prepare('PRAGMA user_version').get()!.user_version,CURRENT_SCHEMA_VERSION);assert.deepEqual(migrated.prepare('SELECT * FROM minutes_snapshots WHERE minutes_id=?').get(id),snapshot);assert.equal(migrated.prepare('SELECT count(*) n FROM minutes_attachments').get()!.n,0);assert.equal(printFinalMinutes({body:oldSnapshot,hash:minutesHash(oldSnapshot)}),html);}finally{migrated.close();}
  let m=(await f.send('post','/minutes',body)).body;let r=await f.upload(m.id,m.version);assert.equal(r.status,200);m=r.body.record;r=await f.send('post',`/minutes/${m.id}/finalize`,{version:m.version,confirmRecordOnly:true});assert.equal(r.status,200);m=r.body;assert.equal(m.snapshot.body.schemaVersion,2);
  const tables=['minutes','minutes_records','minutes_snapshots','minutes_attachments','minutes_attachment_events','hazard_attachments'],rows=Object.fromEntries(tables.map(t=>[t,f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
  const file=join(dir,'current.sqlite');await backup(f.db,file);await createBackup(file,join(dir,'bundle'));const restored=await restoreBackup(join(dir,'bundle'),join(dir,'restored')),check=new DatabaseSync(restored.databasePath);try{assert.equal(check.prepare('PRAGMA user_version').get()!.user_version,CURRENT_SCHEMA_VERSION);for(const t of tables)assert.deepEqual(check.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),rows[t]);assert.deepEqual(check.prepare('PRAGMA foreign_key_check').all(),[]);const stored=check.prepare('SELECT bytes,sha256 FROM minutes_attachments WHERE minutes_id=?').get(m.id)!;assert.deepEqual(Buffer.from(stored.bytes as Uint8Array),png);assert.equal(createHash('sha256').update(stored.bytes as Uint8Array).digest('hex'),stored.sha256);}finally{check.close();}
  assert.deepEqual(f.db.prepare('SELECT * FROM minutes_snapshots WHERE minutes_id=?').get(id),snapshot);assert.equal((await f.agent.get(f.base+`/minutes/${id}/print`)).text,html);
 }finally{f.db.close();await rm(dir,{recursive:true,force:true});}
});
