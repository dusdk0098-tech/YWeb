import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backup,DatabaseSync } from 'node:sqlite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { methodFixture } from './fixtures/risk-method-fixture.js';
import { parseHazardTransfer,hazardReferenceCanonical,type HazardReference } from '../server/work-plan-hazard-reference-values.js';
import { hazardReferences,validHazardSource } from '../server/work-plan-hazard-references.js';
import { WorkPlanHazardReferenceFields } from '../src/WorkPlanHazardReferenceFields.js';
import { workPlanBody } from '../server/work-plan-validation.js';
import { resetPacketBodyJson } from '../server/work-plan-packet.js';
import { openDatabase } from '../server/db.js';
import { CURRENT_SCHEMA_VERSION } from '../server/schema-version.js';
import { createBackup,restoreBackup } from '../scripts/local-backup.js';
const original={title:'Synthetic reference',date:'2026-10-29',startTime:'08:00',endTime:'09:00',location:'Synthetic',workDescription:'Own work',emergencyProcedure:'Own response',verificationNote:'',steps:[{task:'Task',procedure:'Procedure',precaution:'Precaution'}],equipmentIds:[],duties:[]};
function source(row=3):HazardReference{const s:HazardReference={formatVersion:1,sourceFileSha256:'a'.repeat(64),sheet:'Synthetic sheet',sectionCell:'A1',row,section:'Synthetic <section>',category:'Synthetic category',hazard:' Own hazard\n preserved ',control:'Own control',contentHash:''};s.contentHash=createHash('sha256').update(hazardReferenceCanonical(s)).digest('hex');return s;}
test('private source converter synthetic complete rows, missing rows and strict ZIP/XML failures',()=>{execFileSync('python',['-B','tests/plan-hazard-converter.test.py'],{encoding:'utf8'});});
test('hazard reference strict hash/20cap/raw text/legacy and renderer',()=>{
 const s=source(),v={schemaVersion:1,rows:[{source:s,applicationNote:''}]};assert.equal(validHazardSource(s),true);assert.equal(validHazardSource({...s,hazard:'changed'}),false);assert.equal(hazardReferences.safeParse(v).success,true);assert.equal(hazardReferences.safeParse({...v,rows:[{source:null,applicationNote:''}]}).success,false);assert.equal(hazardReferences.safeParse({...v,rows:Array.from({length:21},(_,i)=>({source:source(i+1),applicationNote:''}))}).success,false);assert.equal(hazardReferences.safeParse({...v,rows:[v.rows[0],v.rows[0]]}).success,false);
 assert.equal(parseHazardTransfer({format:'pedit-user-plan-hazard-reference',schemaVersion:1,records:[s]})[0].hazard,s.hazard);assert.throws(()=>parseHazardTransfer({format:'pedit-user-plan-hazard-reference',schemaVersion:1,records:[],extra:true}));assert.equal(JSON.stringify(workPlanBody.parse(original)),JSON.stringify(original));const raw=JSON.stringify(original,null,2);assert.equal(resetPacketBodyJson(raw),raw);
 const html=renderToStaticMarkup(createElement(WorkPlanHazardReferenceFields,{value:{schemaVersion:1,rows:[{source:s,applicationNote:''}]},onChange:()=>{},onBusy:()=>{}}));assert.match(html,/Synthetic &lt;section&gt;/);assert.match(html,/120KiB/);assert.match(html,/자동 덮어쓰지/);
});
test('actual selected source preserved, no overwrite, hash conflict, immutable submit/return and permissions',async()=>{
 const f=await methodFixture();try{
  const s=source(),body={...original,hazardReferences:{schemaVersion:1,rows:[{source:s,applicationNote:'Own applicability only'}]}};let r=await f.send('post','/work-plans',{body});assert.equal(r.status,200,r.text);let p=r.body;const path=`/work-plans/${p.id}`;assert.deepEqual(p.body.steps,original.steps);assert.equal(p.body.hazardReferences.rows[0].source.hazard,s.hazard);
  const forged={...s,hazard:'Different'};assert.equal((await f.send('put',path,{version:p.version,body:{...body,hazardReferences:{schemaVersion:1,rows:[{source:forged,applicationNote:'Own'}]}}})).status,400);forged.contentHash=createHash('sha256').update(hazardReferenceCanonical(forged)).digest('hex');assert.equal((await f.send('put',path,{version:p.version,body:{...body,hazardReferences:{schemaVersion:1,rows:[{source:forged,applicationNote:'Own'}]}}})).status,409);
  assert.equal((await f.reviewSend(path+'/submit',{version:p.version,reason:'Other author',confirmDocumentOnly:true})).status,403);r=await f.send('post',path+'/capture',{version:p.version});p=r.body;
  f.db.exec("CREATE TRIGGER reference_fail BEFORE INSERT ON work_plan_snapshots BEGIN SELECT RAISE(ABORT,'Synthetic rollback');END");assert.equal((await f.send('post',path+'/submit',{version:p.version,reason:'Rollback',confirmDocumentOnly:true})).status,500);assert.equal(f.db.prepare('SELECT status FROM work_plans WHERE id=?').get(p.id)!.status,'draft');f.db.exec('DROP TRIGGER reference_fail');
  const key=randomUUID(),command={version:p.version,reason:'Human record',confirmDocumentOnly:true};r=await f.send('post',path+'/submit',command,key);assert.equal(r.status,200,r.text);p=r.body;assert.deepEqual((await f.send('post',path+'/submit',command,key)).body,p);const html=(await f.agent.get(f.base+path+'/print')).text,snapshot=JSON.stringify(p.snapshot);assert.match(html,new RegExp(s.contentHash));assert.match(html,/Synthetic &lt;section&gt;/);
  const review=(await f.agent.get(f.base+path+'/document-review')).body.review;r=await f.reviewSend(path+'/review',{version:review.version,submissionHash:review.submission_hash,decision:'returned',authorId:f.manager,reason:'Review again',confirmDocumentOnly:true});assert.equal(r.status,200,r.text);const next=r.body.nextDraft;assert.equal(next.body.hazardReferences.rows[0].applicationNote,'');assert.deepEqual(next.body.hazardReferences.rows[0].source,s);assert.equal(JSON.stringify((await f.agent.get(f.base+path)).body.snapshot),snapshot);assert.equal((await f.agent.get(f.base+path+'/print')).text,html);assert.equal((await f.send('post',`/work-plans/${next.id}/submit`,{version:next.version,reason:'Blank memo',confirmDocumentOnly:true})).status,400);
  f.db.prepare("UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?").run(f.site,f.manager);assert.equal((await f.send('put',`/work-plans/${next.id}`,{version:next.version,body:next.body})).status,403);
 }finally{f.db.close();}
});
test('reference archive revision and exact54 migration/backup preserve historical rows',async()=>{
 const f=await methodFixture(),dir=await mkdtemp(join(tmpdir(),'hazard-reference-'));try{
  let r=await f.send('post','/work-plans',{body:original}),p=r.body;r=await f.send('post',`/work-plans/${p.id}/capture`,{version:p.version});p=r.body;r=await f.send('post',`/work-plans/${p.id}/archive`,{version:p.version});assert.equal(r.status,200);
  const tables=['work_plans','work_plan_snapshots','work_plan_events','idempotency','audit'],before=Object.fromEntries(tables.map(t=>[t,f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));const file=join(dir,'old.sqlite');await backup(f.db,file);const old=new DatabaseSync(file);old.exec('PRAGMA user_version=54');old.close();const db=openDatabase(file);try{assert.equal(db.prepare('PRAGMA user_version').get()!.user_version,CURRENT_SCHEMA_VERSION);for(const t of tables)assert.deepEqual(db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),before[t]);}finally{db.close();}
  r=await f.send('post','/work-plans',{body:{...original,hazardReferences:{schemaVersion:1,rows:[{source:source(),applicationNote:'Own memo'}]}}});p=r.body;r=await f.send('post',`/work-plans/${p.id}/capture`,{version:p.version});p=r.body;r=await f.send('post',`/work-plans/${p.id}/archive`,{version:p.version});assert.equal(r.status,200);p=r.body;r=await f.send('post',`/work-plans/${p.id}/revise`,{version:p.version,reason:'Correction',authorId:f.manager});assert.equal(r.status,200);assert.equal(r.body.body.hazardReferences.rows[0].applicationNote,'');
  const current=join(dir,'current.sqlite');await backup(f.db,current);assert.equal((await createBackup(current,join(dir,'bundle'))).schemaVersion,CURRENT_SCHEMA_VERSION);const restored=await restoreBackup(join(dir,'bundle'),join(dir,'restored'));const copy=new DatabaseSync(restored.databasePath);try{for(const t of tables)assert.deepEqual(copy.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all());}finally{copy.close();}
 }finally{f.db.close();await rm(dir,{recursive:true,force:true});}
});
