import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backup,DatabaseSync } from 'node:sqlite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { methodFixture } from './fixtures/risk-method-fixture.js';
import { packetKinds,blankPacket,type PlanPacket } from '../server/work-plan-packet-values.js';
import { planPacketSchema,completePacket } from '../server/work-plan-packet-schema.js';
import { resetPacketBodyJson,validatePacketSnapshot } from '../server/work-plan-packet.js';
import { workPlanBody } from '../server/work-plan-validation.js';
import { WorkPlanPacketFields } from '../src/WorkPlanPacketFields.js';
import { openDatabase } from '../server/db.js';
import { createBackup,restoreBackup } from '../scripts/local-backup.js';
import { printWorkPlan } from '../server/work-plan-print.js';
import { fullWorkPlan,getWorkPlan } from '../server/work-plan-model.js';
import { attachmentUsage } from '../server/attachment-quota.js';
const original={title:'Synthetic packet',date:'2026-10-29',startTime:'08:00',endTime:'09:00',location:'Synthetic',workDescription:'Own work',emergencyProcedure:'Own response',verificationNote:'No legal claim',steps:[{task:'Task',procedure:'Procedure',precaution:'Precaution'}],equipmentIds:[] as string[],duties:[]};
const pdf=Buffer.from('%PDF-1.7\nSynthetic only, unscanned');
async function fixture(){
 const f=await methodFixture(),equipment=randomUUID(),now='2026-10-29T00:00:00Z';
 f.db.prepare("INSERT INTO equipment(id,site_id,asset_code,body,status,version,created_at,updated_at) VALUES(?,?,? ,?,'active',1,?,?)").run(equipment,f.site,'SYNTHETIC',JSON.stringify({assetCode:'SYNTHETIC',name:'Synthetic machine',typeLabel:'Synthetic type',model:'',serial:'',ownerCompany:'',notes:''}),now,now);
 const body={...original,equipmentIds:[equipment]},csrf=(await f.agent.get('/api/session')).body.csrf;
 async function draft(){const r=await f.send('post','/work-plans',{body});assert.equal(r.status,200,r.text);return r.body;}
 const upload=(id:string,version:number)=>f.agent.post(f.base+`/work-plans/${id}/attachments`).set('Origin','http://127.0.0.1:3000').set('x-csrf-token',csrf).set('content-type','application/octet-stream').set('x-work-plan-version',String(version)).set('x-file-name',encodeURIComponent('<synthetic>.pdf')).set('x-file-type','application/pdf').set('idempotency-key',randomUUID()).send(pdf);
 function packet(fileId:string):PlanPacket{return {schemaVersion:1,equipmentId:equipment,rows:[{kind:'registration',state:'linked',fileId,note:'User reference only'},{kind:'insurance',state:'linked',fileId,note:'Same original, no certification'},{kind:'inspection',state:'missing',fileId:null,note:'Not obtained'}]};}
 return {...f,equipment,body,draft,upload,packet};
}
test('packet schema distinguishes missing/null/files, 12 unique categories and byte-compatible absent optional fields',()=>{
 const p=blankPacket();assert.equal(completePacket(p),false);assert.equal(planPacketSchema.safeParse(p).success,true);
 const rows=Object.keys(packetKinds).map(kind=>({kind,state:'missing',fileId:null,note:'Own reason'}));assert.equal(planPacketSchema.safeParse({...p,rows}).success,true);assert.equal(planPacketSchema.safeParse({...p,rows:[...rows,rows[0]]}).success,false);
 assert.equal(planPacketSchema.safeParse({...p,rows:[{...rows[0],fileId:randomUUID()}]}).success,false);assert.equal(planPacketSchema.safeParse({...p,legalApproved:true}).success,false);
 assert.equal(JSON.stringify(workPlanBody.parse(original)),JSON.stringify(original));const raw=JSON.stringify(original,null,2);assert.equal(resetPacketBodyJson(raw),raw);
 const html=renderToStaticMarkup(createElement(WorkPlanPacketFields,{siteId:'s',equipmentIds:[],value:p,onChange:()=>{},onBusy:()=>{}}));assert.match(html,/선택 장비1대/);assert.match(html,/미확보/);assert.match(html,/파일 안전성/);assert.match(html,/초안을 먼저 저장/);
});
test('actual packet same-plan active files, detach unavailable, source stale, submit snapshot, return reset and unchanged parent',async()=>{
 const f=await fixture();try{
  let p=await f.draft(),r=await f.upload(p.id,p.version);assert.equal(r.status,200,r.text);p=r.body.record;const file=r.body.attachments[0],path=`/work-plans/${p.id}`;
  const other=await f.draft();assert.equal((await f.send('put',`/work-plans/${other.id}`,{version:other.version,body:{...f.body,documentPacket:f.packet(file.id)}})).status,409);
  assert.equal((await f.send('put',path,{version:p.version,body:{...f.body,documentPacket:{...f.packet(file.id),equipmentId:randomUUID()}}})).status,409);
  const bytes=attachmentUsage(f.db,f.site,p.id,'work_plan');r=await f.send('put',path,{version:p.version,body:{...f.body,documentPacket:f.packet(file.id)}});assert.equal(r.status,200,r.text);p=r.body;assert.deepEqual(attachmentUsage(f.db,f.site,p.id,'work_plan'),bytes);
  r=await f.send('post',path+'/capture',{version:p.version});p=r.body;
  r=await f.send('post',path+`/attachments/${file.id}/state`,{version:p.version,attached:false,reason:'Synthetic detach'});assert.equal(r.status,200,r.text);p=r.body.record;
  assert.match((await f.agent.get(f.base+path+'/print')).text,/참조 불가/);
  assert.equal((await f.send('post',path+'/submit',{version:p.version,reason:'Not active',confirmDocumentOnly:true})).status,409);
  assert.equal((await f.send('post',path+'/archive',{version:p.version})).status,409);
  r=await f.send('post',path+`/attachments/${file.id}/state`,{version:p.version,attached:true,reason:'Explicit reconnect'});p=r.body.record;
  f.db.prepare('UPDATE equipment SET version=version+1 WHERE id=?').run(f.equipment);assert.equal((await f.send('post',path+'/submit',{version:p.version,reason:'Old source',confirmDocumentOnly:true})).status,409);
  r=await f.send('post',path+'/capture',{version:p.version});p=r.body;
  f.db.exec("CREATE TRIGGER packet_fail BEFORE INSERT ON work_plan_snapshots BEGIN SELECT RAISE(ABORT,'Synthetic rollback');END");assert.equal((await f.send('post',path+'/submit',{version:p.version,reason:'Rollback',confirmDocumentOnly:true})).status,500);assert.equal(f.db.prepare('SELECT status FROM work_plans WHERE id=?').get(p.id)!.status,'draft');f.db.exec('DROP TRIGGER packet_fail');
  const key=randomUUID(),command={version:p.version,reason:'Document record only',confirmDocumentOnly:true};r=await f.send('post',path+'/submit',command,key);assert.equal(r.status,200,r.text);p=r.body;assert.deepEqual((await f.send('post',path+'/submit',command,key)).body,p);
  assert.equal(p.snapshot.body.attachmentManifest.items.length,1);assert.equal(p.snapshot.body.body.documentPacket.rows[0].fileId,file.id);const before=JSON.stringify(p.snapshot);const html=(await f.agent.get(f.base+path+'/print')).text;assert.match(html,/&lt;synthetic&gt;.pdf/);assert.match(html,new RegExp(file.sha256));assert.match(html,/미확보로 기록/);
  const bad=structuredClone(p.snapshot.body);bad.attachmentManifest.items=[];assert.throws(()=>validatePacketSnapshot(bad));
  f.db.prepare("UPDATE equipment SET status='retired',version=version+1 WHERE id=?").run(f.equipment);const view=(await f.agent.get(f.base+path+'/document-review')).body.review;const decision={version:view.version,submissionHash:view.submission_hash,reason:'Own review',confirmDocumentOnly:true};assert.equal((await f.reviewSend(path+'/review',{...decision,decision:'accepted'})).status,409);
  r=await f.reviewSend(path+'/review',{...decision,decision:'returned',authorId:f.manager});assert.equal(r.status,200,r.text);const next=r.body.nextDraft;assert.ok(next.body.documentPacket.rows.every((row:{state:unknown;fileId:unknown;note:string})=>row.state===null&&row.fileId===null&&row.note===''));assert.equal(next.source_capture,null);assert.equal(f.db.prepare('SELECT count(*) n FROM work_plan_attachments WHERE plan_id=?').get(next.id)!.n,0);
  assert.equal(JSON.stringify((await f.agent.get(f.base+path)).body.snapshot),before);assert.equal((await f.agent.get(f.base+path+'/print')).text,html);
 }finally{f.db.close();}
});
test('manager archive/revise packet reset, 50 to51 historical bytes and complete shared BLOB backup',async()=>{
 const f=await fixture(),dir=await mkdtemp(join(tmpdir(),'packet-migration-'));try{
  let p=await f.draft(),r=await f.send('post',`/work-plans/${p.id}/capture`,{version:p.version});p=r.body;r=await f.send('post',`/work-plans/${p.id}/archive`,{version:p.version});assert.equal(r.status,200);const legacy=r.body,legacyHtml=(await f.agent.get(f.base+`/work-plans/${legacy.id}/print`)).text;
  const tables=['work_plans','work_plan_snapshots','work_plan_events','idempotency','audit'];const before=Object.fromEntries(tables.map(t=>[t,f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));const file=join(dir,'legacy.sqlite');await backup(f.db,file);const old=new DatabaseSync(file);old.exec('PRAGMA user_version=50');old.close();const migrated=openDatabase(file);try{assert.equal(migrated.prepare('PRAGMA user_version').get()!.user_version,CURRENT_SCHEMA_VERSION);for(const t of tables)assert.deepEqual(migrated.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),before[t]);const snap=fullWorkPlan(migrated,getWorkPlan(migrated,f.site,legacy.id)).snapshot!;assert.equal(printWorkPlan(snap.body,snap.hash),legacyHtml);}finally{migrated.close();}
  p=await f.draft();r=await f.upload(p.id,p.version);p=r.body.record;const attachment=r.body.attachments[0];r=await f.send('put',`/work-plans/${p.id}`,{version:p.version,body:{...f.body,documentPacket:f.packet(attachment.id)}});p=r.body;r=await f.send('post',`/work-plans/${p.id}/capture`,{version:p.version});p=r.body;r=await f.send('post',`/work-plans/${p.id}/archive`,{version:p.version});assert.equal(r.status,200,r.text);p=r.body;
  r=await f.send('post',`/work-plans/${p.id}/revise`,{version:p.version,reason:'Own correction',authorId:f.manager});assert.equal(r.status,200);assert.ok(r.body.body.documentPacket.rows.every((x:{fileId:unknown})=>x.fileId===null));
  const current=join(dir,'current.sqlite');await backup(f.db,current);const manifest=await createBackup(current,join(dir,'bundle'));assert.equal(manifest.schemaVersion,CURRENT_SCHEMA_VERSION);const restored=await restoreBackup(join(dir,'bundle'),join(dir,'restored'));const db=new DatabaseSync(restored.databasePath);try{for(const t of ['work_plans','work_plan_snapshots','work_plan_attachments','work_plan_attachment_events'])assert.deepEqual(db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);}finally{db.close();}
  f.db.prepare("UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?").run(f.site,f.manager);assert.equal((await f.send('post','/work-plans',{body:{...f.body,documentPacket:blankPacket()}})).status,403);
 }finally{f.db.close();await rm(dir,{recursive:true,force:true});}
});
