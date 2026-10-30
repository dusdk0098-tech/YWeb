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
import { resetPacketBodyJson } from '../server/work-plan-packet.js';
import { workPlanBody } from '../server/work-plan-validation.js';
import { WorkPlanLiftingFields,blankLifting } from '../src/WorkPlanLiftingFields.js';
import { liftingDetail,completeLifting,validateLiftingSnapshot,type LiftingDetail } from '../server/work-plan-lifting.js';
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
 return {...f,equipment,body,draft,upload};
}
function detail(equipmentId:string,fileId:string|null=null):LiftingDetail{const length={value:'0.123456',unit:'m' as const,basis:'Synthetic source'},mass={value:'0',unit:'t' as const,basis:'Synthetic zero not empty'};return {schemaVersion:1,equipmentId,task:'Synthetic task',cargoDescription:'Synthetic <cargo>',radius:length,height:length,boomLength:length,ratedLoad:mass,cargoMass:mass,hookRopeMass:mass,cargoLength:length,cargoWidth:length,cargoHeight:length,rigging:[{kind:'Synthetic sling',specification:'User specification',quantity:1,basis:'Source'}],sourceNote:'Manual only',fileId,confirmationNote:'No safety claim'};}
test('lifting exact decimals, null/zero, units, six rows, no coefficients and SSR',()=>{
 const v=detail(randomUUID());assert.equal(completeLifting(v),true);assert.equal(completeLifting(blankLifting()),false);for(const value of ['1.3.5','NaN','Infinity','1e3','-1','1000000.000001','0.1234567'])assert.equal(liftingDetail.safeParse({...v,radius:{...v.radius,value}}).success,false,value);assert.equal(liftingDetail.safeParse({...v,radius:{...v.radius,value:'1000000.000000'}}).success,true);assert.equal(liftingDetail.safeParse({...v,ratedLoad:{...v.ratedLoad,unit:'m'}}).success,false);assert.equal(liftingDetail.safeParse({...v,radius:{...v.radius,unit:''}}).success,false);assert.equal(liftingDetail.safeParse({...v,loadFactor:1.3}).success,false);assert.equal(liftingDetail.safeParse({...v,rigging:Array.from({length:7},()=>v.rigging[0])}).success,false);for(const quantity of [0,-1,1.5,Infinity,1000001])assert.equal(liftingDetail.safeParse({...v,rigging:[{...v.rigging[0],quantity}]}).success,false);
 assert.equal(JSON.stringify(workPlanBody.parse(original)),JSON.stringify(original));const raw=JSON.stringify(original,null,2);assert.equal(resetPacketBodyJson(raw),raw);const html=renderToStaticMarkup(createElement(WorkPlanLiftingFields,{siteId:'s',equipmentIds:[],value:blankLifting(),onChange:()=>{},onBusy:()=>{}}));assert.match(html,/별도이며 자동 복사/);assert.match(html,/최대6행/);assert.match(html,/자체 문서 조건/);
});
test('actual lifting active selected equipment/file, source stale, fixed snapshot, rollback and return reset',async()=>{
 const f=await fixture();try{
  let p=await f.draft(),r=await f.upload(p.id,p.version);p=r.body.record;const file=r.body.attachments[0],path=`/work-plans/${p.id}`;const v=detail(f.equipment,file.id);
  assert.equal((await f.send('put',path,{version:p.version,body:{...f.body,liftingDetail:{...v,equipmentId:randomUUID()}}})).status,409);const other=await f.draft();assert.equal((await f.send('put',`/work-plans/${other.id}`,{version:other.version,body:{...f.body,liftingDetail:v}})).status,409);
  const bytes=attachmentUsage(f.db,f.site,p.id,'work_plan');r=await f.send('put',path,{version:p.version,body:{...f.body,liftingDetail:v}});assert.equal(r.status,200,r.text);p=r.body;assert.deepEqual(attachmentUsage(f.db,f.site,p.id,'work_plan'),bytes);assert.match((await f.agent.get(f.base+path+'/print')).text,/&lt;synthetic&gt;.pdf/);
  r=await f.send('post',path+'/capture',{version:p.version});p=r.body;r=await f.send('post',path+`/attachments/${file.id}/state`,{version:p.version,attached:false,reason:'Detach'});p=r.body.record;assert.match((await f.agent.get(f.base+path+'/print')).text,/원본 참조 불가/);assert.equal((await f.send('post',path+'/submit',{version:p.version,reason:'Detached',confirmDocumentOnly:true})).status,409);r=await f.send('post',path+`/attachments/${file.id}/state`,{version:p.version,attached:true,reason:'Reconnect'});p=r.body.record;
  f.db.prepare('UPDATE equipment SET version=version+1 WHERE id=?').run(f.equipment);assert.equal((await f.send('post',path+'/archive',{version:p.version})).status,409);r=await f.send('post',path+'/capture',{version:p.version});p=r.body;
  f.db.exec("CREATE TRIGGER lifting_fail BEFORE INSERT ON work_plan_snapshots BEGIN SELECT RAISE(ABORT,'Synthetic rollback');END");assert.equal((await f.send('post',path+'/submit',{version:p.version,reason:'Rollback',confirmDocumentOnly:true})).status,500);assert.equal(f.db.prepare('SELECT status FROM work_plans WHERE id=?').get(p.id)!.status,'draft');f.db.exec('DROP TRIGGER lifting_fail');
  const key=randomUUID(),command={version:p.version,reason:'Own document',confirmDocumentOnly:true};r=await f.send('post',path+'/submit',command,key);assert.equal(r.status,200,r.text);p=r.body;assert.deepEqual((await f.send('post',path+'/submit',command,key)).body,p);const html=(await f.agent.get(f.base+path+'/print')).text,snapshot=JSON.stringify(p.snapshot);assert.match(html,/Synthetic &lt;cargo&gt;/);assert.match(html,new RegExp(file.sha256));assert.match(html,/0.123456 m/);const bad=structuredClone(p.snapshot.body);bad.attachmentManifest.items=[];assert.throws(()=>validateLiftingSnapshot(bad.body,bad.attachmentManifest));
  f.db.prepare("UPDATE equipment SET status='retired',version=version+1 WHERE id=?").run(f.equipment);const view=(await f.agent.get(f.base+path+'/document-review')).body.review,decision={version:view.version,submissionHash:view.submission_hash,reason:'Own review',confirmDocumentOnly:true};assert.equal((await f.reviewSend(path+'/review',{...decision,decision:'accepted'})).status,409);r=await f.reviewSend(path+'/review',{...decision,decision:'returned',authorId:f.manager});assert.equal(r.status,200,r.text);const next=r.body.nextDraft,d=next.body.liftingDetail;assert.equal(d.fileId,null);assert.equal(d.sourceNote,'');assert.equal(d.confirmationNote,'');assert.equal(d.radius.basis,'');assert.equal(d.rigging[0].basis,'');assert.equal(d.radius.value,v.radius.value);assert.equal(next.source_capture,null);assert.equal(JSON.stringify((await f.agent.get(f.base+path)).body.snapshot),snapshot);assert.equal((await f.agent.get(f.base+path+'/print')).text,html);
  f.db.prepare("UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?").run(f.site,f.manager);assert.equal((await f.send('put',`/work-plans/${next.id}`,{version:next.version,body:next.body})).status,403);
 }finally{f.db.close();}
});
test('lifting optional original archive/revise, exact53 migration old bytes and backup',async()=>{
 const f=await fixture(),dir=await mkdtemp(join(tmpdir(),'lifting-'));try{
  let p=await f.draft(),r=await f.send('post',`/work-plans/${p.id}/capture`,{version:p.version});p=r.body;r=await f.send('post',`/work-plans/${p.id}/archive`,{version:p.version});assert.equal(r.status,200);const legacy=r.body,html=(await f.agent.get(f.base+`/work-plans/${legacy.id}/print`)).text;
  const tables=['work_plans','work_plan_snapshots','work_plan_events','idempotency','audit'],before=Object.fromEntries(tables.map(t=>[t,f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));const file=join(dir,'old.sqlite');await backup(f.db,file);const old=new DatabaseSync(file);old.exec('PRAGMA user_version=53');old.close();const db=openDatabase(file);try{assert.equal(db.prepare('PRAGMA user_version').get()!.user_version,CURRENT_SCHEMA_VERSION);for(const t of tables)assert.deepEqual(db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),before[t]);const snap=fullWorkPlan(db,getWorkPlan(db,f.site,legacy.id)).snapshot!;assert.equal(printWorkPlan(snap.body,snap.hash),html);}finally{db.close();}
  r=await f.send('post','/work-plans',{body:{...f.body,liftingDetail:detail(f.equipment)}});p=r.body;r=await f.send('post',`/work-plans/${p.id}/capture`,{version:p.version});p=r.body;r=await f.send('post',`/work-plans/${p.id}/archive`,{version:p.version});assert.equal(r.status,200,r.text);p=r.body;assert.equal(p.snapshot.body.attachmentManifest.items.length,0);r=await f.send('post',`/work-plans/${p.id}/revise`,{version:p.version,reason:'Own correction',authorId:f.manager});assert.equal(r.status,200);assert.equal(r.body.body.liftingDetail.ratedLoad.basis,'');
  const current=join(dir,'current.sqlite');await backup(f.db,current);assert.equal((await createBackup(current,join(dir,'bundle'))).schemaVersion,CURRENT_SCHEMA_VERSION);const restored=await restoreBackup(join(dir,'bundle'),join(dir,'restored'));const copy=new DatabaseSync(restored.databasePath);try{for(const t of tables)assert.deepEqual(copy.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());}finally{copy.close();}
 }finally{f.db.close();await rm(dir,{recursive:true,force:true});}
});
