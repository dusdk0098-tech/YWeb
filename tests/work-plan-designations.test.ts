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
import { designationRecords,completeDesignations,validateDesignationReferences,validateDesignationSnapshot } from '../server/work-plan-designations.js';
import { resetPacketBodyJson } from '../server/work-plan-packet.js';
import { workPlanBody,type WorkPlanBody } from '../server/work-plan-validation.js';
import { WorkPlanDesignationFields } from '../src/WorkPlanDesignationFields.js';
import { openDatabase } from '../server/db.js';
import { CURRENT_SCHEMA_VERSION } from '../server/schema-version.js';
import { createBackup,restoreBackup } from '../scripts/local-backup.js';
const original:WorkPlanBody={title:'Synthetic designation',date:'2026-10-29',startTime:'08:00',endTime:'09:00',location:'Synthetic',workDescription:'Own work',emergencyProcedure:'Own response',verificationNote:'',steps:[{task:'Task',procedure:'Procedure',precaution:'Precaution'}],equipmentIds:[],duties:[]};
const row=(workerId:string|null)=>({kind:'commander' as const,label:'Synthetic <role>',workerId,scope:'Own scope',task:'Own task',equipmentIds:[] as string[],noEquipmentReason:'No equipment for this task',recordDate:'2026-10-29',basis:'Human note only'});
test('designation strict limits, null draft, selected references, legacy bytes and SSR',()=>{
 const v={schemaVersion:1 as const,rows:[row(null)]};assert.ok(designationRecords.safeParse(v).success);assert.equal(completeDesignations(v),false);assert.equal(designationRecords.safeParse({...v,rows:Array.from({length:11},()=>row(null))}).success,false);assert.equal(designationRecords.safeParse({...v,rows:[{...row(null),recordDate:'2026-02-30'}]}).success,false);assert.equal(designationRecords.safeParse({...v,consent:true}).success,false);
 const id=randomUUID();assert.equal(completeDesignations({...v,rows:[row(id),row(id)]}),false);assert.throws(()=>validateDesignationReferences({...original,designationRecords:{...v,rows:[row(id)]}}));assert.throws(()=>validateDesignationReferences({...original,designationRecords:{...v,rows:[{...row(null),equipmentIds:[id]}]}}));assert.throws(()=>validateDesignationSnapshot({...original,designationRecords:v}));
 assert.equal(JSON.stringify(workPlanBody.parse(original)),JSON.stringify(original));const raw=JSON.stringify(original,null,2);assert.equal(resetPacketBodyJson(raw),raw);
 const html=renderToStaticMarkup(createElement(WorkPlanDesignationFields,{value:v,workerIds:[],equipmentIds:[],onChange:()=>{}}));assert.match(html,/로그인 계정이 아닌/);assert.match(html,/최대 10행/);assert.match(html,/자체 문서 조건/);
});
test('actual designation draft, source changes, atomic submit, fixed HTML, return reset, permissions',async()=>{
 const f=await methodFixture();try{
  const id=randomUUID(),now='2026-10-29T00:00:00Z';f.db.prepare("INSERT INTO workers VALUES(?,?,?,?,'worker',1,1,?,?)").run(id,f.site,'Synthetic <person>','Synthetic group',now,now);
  const body={...original,duties:[{workerId:id,duty:'Own memo'}],designationRecords:{schemaVersion:1 as const,rows:[row(id)]}};
  assert.equal((await f.send('post','/work-plans',{body:{...body,duties:[]}})).status,409);
  let r=await f.send('post','/work-plans',{body});assert.equal(r.status,200,r.text);let p=r.body;const path=`/work-plans/${p.id}`;
  assert.equal((await f.reviewSend(path+'/submit',{version:p.version,reason:'Other author',confirmDocumentOnly:true})).status,403);
  const otherSite=randomUUID(),otherWorker=randomUUID();f.db.prepare('INSERT INTO sites(id,name) VALUES(?,?)').run(otherSite,'Other synthetic');f.db.prepare("INSERT INTO workers VALUES(?,?,?,?,'worker',1,1,?,?)").run(otherWorker,otherSite,'Other synthetic','Group',now,now);assert.equal((await f.send('post','/work-plans',{body:{...body,duties:[{workerId:otherWorker,duty:'Wrong site'}],designationRecords:{schemaVersion:1,rows:[row(otherWorker)]}}})).status,404);
  assert.equal((await f.send('post','/work-plans',{body:{...body,designationRecords:{schemaVersion:1,rows:[{...row(id),equipmentIds:[randomUUID()]}]}}})).status,409);
  const incomplete=await f.send('post','/work-plans',{body:{...body,designationRecords:{schemaVersion:1,rows:[row(null)]}}});assert.equal(incomplete.status,200);assert.equal((await f.send('post',`/work-plans/${incomplete.body.id}/submit`,{version:incomplete.body.version,reason:'Incomplete',confirmDocumentOnly:true})).status,400);
  r=await f.send('post',path+'/capture',{version:p.version});p=r.body;f.db.prepare('UPDATE workers SET version=version+1 WHERE id=?').run(id);
  assert.equal((await f.send('post',path+'/submit',{version:p.version,reason:'Old source',confirmDocumentOnly:true})).status,409);
  r=await f.send('post',path+'/capture',{version:p.version});p=r.body;
  f.db.exec("CREATE TRIGGER designation_fail BEFORE INSERT ON work_plan_snapshots BEGIN SELECT RAISE(ABORT,'Synthetic rollback');END");assert.equal((await f.send('post',path+'/submit',{version:p.version,reason:'Rollback',confirmDocumentOnly:true})).status,500);assert.equal(f.db.prepare('SELECT status FROM work_plans WHERE id=?').get(p.id)!.status,'draft');f.db.exec('DROP TRIGGER designation_fail');
  const key=randomUUID(),command={version:p.version,reason:'Document only',confirmDocumentOnly:true};r=await f.send('post',path+'/submit',command,key);assert.equal(r.status,200,r.text);p=r.body;assert.deepEqual((await f.send('post',path+'/submit',command,key)).body,p);
  const html=(await f.agent.get(f.base+path+'/print')).text;assert.match(html,/Synthetic &lt;person&gt;/);assert.match(html,/Synthetic &lt;role&gt;/);assert.match(html,/법적 적합성을 인증하지/);const snapshot=JSON.stringify(p.snapshot);
  f.db.prepare('UPDATE workers SET active=0,version=version+1 WHERE id=?').run(id);const view=(await f.agent.get(f.base+path+'/document-review')).body.review;const decision={version:view.version,submissionHash:view.submission_hash,reason:'Own review',confirmDocumentOnly:true};assert.equal((await f.reviewSend(path+'/review',{...decision,decision:'accepted'})).status,409);
  r=await f.reviewSend(path+'/review',{...decision,decision:'returned',authorId:f.manager});assert.equal(r.status,200,r.text);const next=r.body.nextDraft,dr=next.body.designationRecords.rows[0];assert.equal(dr.workerId,null);assert.equal(dr.recordDate,null);assert.equal(dr.basis,'');assert.equal(dr.scope,'Own scope');assert.equal(next.source_capture,null);
  assert.equal(JSON.stringify((await f.agent.get(f.base+path)).body.snapshot),snapshot);assert.equal((await f.agent.get(f.base+path+'/print')).text,html);
  f.db.prepare("UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?").run(f.site,f.manager);assert.equal((await f.send('put',`/work-plans/${next.id}`,{version:next.version,body:next.body})).status,403);
 }finally{f.db.close();}
});
test('designation archive revision, exact 51 migration legacy rows and backup',async()=>{
 const f=await methodFixture(),dir=await mkdtemp(join(tmpdir(),'designation-'));try{
  let r=await f.send('post','/work-plans',{body:original}),p=r.body;r=await f.send('post',`/work-plans/${p.id}/capture`,{version:p.version});p=r.body;r=await f.send('post',`/work-plans/${p.id}/archive`,{version:p.version});assert.equal(r.status,200,r.text);
  const tables=['work_plans','work_plan_snapshots','work_plan_events','idempotency','audit'],before=Object.fromEntries(tables.map(t=>[t,f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));const file=join(dir,'old.sqlite');await backup(f.db,file);const old=new DatabaseSync(file);old.exec('PRAGMA user_version=51');old.close();const db=openDatabase(file);try{assert.equal(db.prepare('PRAGMA user_version').get()!.user_version,CURRENT_SCHEMA_VERSION);for(const t of tables)assert.deepEqual(db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),before[t]);}finally{db.close();}
  const id=randomUUID(),now='2026-10-29T00:00:00Z';f.db.prepare("INSERT INTO workers VALUES(?,?,?,?,'visitor',1,1,?,?)").run(id,f.site,'Synthetic visitor','Synthetic group',now,now);const body={...original,duties:[{workerId:id,duty:'Human selection'}],designationRecords:{schemaVersion:1 as const,rows:[row(id)]}};
  r=await f.send('post','/work-plans',{body});p=r.body;r=await f.send('post',`/work-plans/${p.id}/capture`,{version:p.version});p=r.body;r=await f.send('post',`/work-plans/${p.id}/archive`,{version:p.version});assert.equal(r.status,200,r.text);p=r.body;r=await f.send('post',`/work-plans/${p.id}/revise`,{version:p.version,reason:'Correction',authorId:f.manager});assert.equal(r.status,200,r.text);assert.equal(r.body.body.designationRecords.rows[0].workerId,null);assert.equal(r.body.body.designationRecords.rows[0].basis,'');
  const current=join(dir,'current.sqlite');await backup(f.db,current);assert.equal((await createBackup(current,join(dir,'bundle'))).schemaVersion,CURRENT_SCHEMA_VERSION);const restored=await restoreBackup(join(dir,'bundle'),join(dir,'restored'));const copy=new DatabaseSync(restored.databasePath);try{for(const t of tables)assert.deepEqual(copy.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());}finally{copy.close();}
 }finally{f.db.close();await rm(dir,{recursive:true,force:true});}
});
