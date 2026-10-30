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
import { blankPlanForm,blankCargo,workPlanForm,planMeasurement,completePlanForm,printPlanForm,type PlanForm } from '../server/work-plan-forms.js';
import { workPlanBody,workPlanEdit,completePlan } from '../server/work-plan-validation.js';
import { printWorkPlan } from '../server/work-plan-print.js';
import { openDatabase } from '../server/db.js';
import { createBackup,restoreBackup } from '../scripts/local-backup.js';
import { fullWorkPlan,getWorkPlan } from '../server/work-plan-model.js';
import { WorkPlanFormFields } from '../src/WorkPlanFormFields.js';
import { WorkPlanEditor } from '../src/WorkPlanEditor.js';
const body={title:'Synthetic plan',date:'2026-10-29',startTime:'08:00',endTime:'09:00',location:'Synthetic',workDescription:'Synthetic',emergencyProcedure:'Own response',verificationNote:'No engineering approval',steps:[{task:'Task',procedure:'Procedure',precaution:'Precaution'}],equipmentIds:[],duties:[]};
function filled(kind:PlanForm['kind']):PlanForm{
 const f=blankPlanForm(kind),answer={state:'provided' as const,note:'Synthetic <input>'},length={value:'0',unit:'m' as const,basis:'Own source'},weight={...length,unit:'t' as const};
 f.terrain=answer;f.groundwater={state:'not_applicable',note:'Human reason'};f.route=answer;for(const k of Object.keys(f.measures) as (keyof typeof f.measures)[])f.measures[k]=answer;
 if(f.kind==='general_machine')f.equipmentMass=weight;
 else{f.radius=length;f.liftHeight={...length,unit:'mm'};f.ratedLoad=weight;f.cargo=[{description:'Synthetic cargo',length,height:length,width:length,unitMass:weight,otherMass:weight}];}
 return f;
}
test('two form strict schemas preserve null versus zero, exact decimals, units and own completeness',()=>{
 for(const kind of ['general_machine','excavator_lift'] as const){const b=blankPlanForm(kind);assert.equal(workPlanForm.safeParse(b).success,true);assert.equal(completePlanForm(b),false);const f=filled(kind);assert.equal(workPlanForm.safeParse(f).success,true);assert.equal(completePlan({...body,documentForm:f}),true);const html=printPlanForm(f);assert.match(html,/0 /);assert.match(html,/&lt;input&gt;/);assert.match(printPlanForm(b),/미입력/);}
 for(const value of ['-1','NaN','Infinity','1e2','1000000.000001','1.0000001','01','+1',' 1'])assert.equal(planMeasurement.safeParse({value,unit:'m',basis:''}).success,false,value);
 for(const value of ['0','0.000001','1000000.000000'])assert.equal(planMeasurement.safeParse({value,unit:'m',basis:''}).success,true,value);
 assert.equal(planMeasurement.safeParse({value:'1',unit:'',basis:''}).success,false);assert.equal(planMeasurement.safeParse({value:Infinity,unit:'m',basis:''}).success,false);
 const f=filled('excavator_lift');if(f.kind==='excavator_lift'){f.cargo=Array.from({length:7},blankCargo);assert.equal(workPlanForm.safeParse(f).success,false);}
 assert.equal(workPlanForm.safeParse({...blankPlanForm('general_machine'),safeLoad:'1'}).success,false);
 assert.equal(JSON.stringify(workPlanBody.parse(body)),JSON.stringify(body));assert.equal(JSON.stringify(workPlanEdit.parse({version:1,body})),JSON.stringify({version:1,body}));
});
test('both forms real save/reopen submit/return/revise exact snapshot and human review with no inherited files',async()=>{
 const f=await methodFixture();try{
 for(const kind of ['general_machine','excavator_lift'] as const){
  const input={...body,documentForm:blankPlanForm(kind)},key=randomUUID();let r=await f.send('post','/work-plans',{body:input},key);assert.equal(r.status,200,r.text);let p=r.body;const path=`/work-plans/${p.id}`;
  assert.deepEqual((await f.send('post','/work-plans',{body:input},key)).body,p);assert.deepEqual((await f.agent.get(f.base+path)).body.body.documentForm,input.documentForm);
  r=await f.send('post',path+'/capture',{version:p.version});p=r.body;assert.equal((await f.send('post',path+'/submit',{version:p.version,reason:'Not complete',confirmDocumentOnly:true})).status,400);
  assert.equal((await f.send('put',path,{version:p.version,body})).status,409);
  const complete={...body,documentForm:filled(kind)};r=await f.send('put',path,{version:p.version,body:complete});assert.equal(r.status,200,r.text);p=r.body;
  assert.equal((await f.send('put',path,{version:p.version-1,body:complete})).status,409);
  r=await f.send('post',path+'/capture',{version:p.version});p=r.body;r=await f.send('post',path+'/submit',{version:p.version,reason:'Own document check',confirmDocumentOnly:true});assert.equal(r.status,200,r.text);p=r.body;
  const snap=f.db.prepare('SELECT * FROM work_plan_snapshots WHERE plan_id=?').get(p.id);const html=(await f.agent.get(f.base+path+'/print')).text;assert.match(html,/자체 문서 완결 조건/);assert.match(html,/안전하중 계산은 제공하지 않습니다/);
  const review=(await f.agent.get(f.base+path+'/document-review')).body.review;const decision={version:review.version,submissionHash:review.submission_hash,decision:'returned',authorId:f.manager,reason:'Synthetic amend',confirmDocumentOnly:true};
  assert.equal((await f.send('post',path+'/review',decision)).status,403);
  r=await f.reviewSend(path+'/review',decision);assert.equal(r.status,200,r.text);const next=r.body.nextDraft;assert.deepEqual(next.body.documentForm,complete.documentForm);assert.equal(next.source_capture,null);assert.equal(f.db.prepare('SELECT count(*) n FROM work_plan_attachments WHERE plan_id=?').get(next.id)!.n,0);
  assert.deepEqual(f.db.prepare('SELECT * FROM work_plan_snapshots WHERE plan_id=?').get(p.id),snap);assert.equal((await f.agent.get(f.base+path+'/print')).text,html);
  r=await f.send('post',`/work-plans/${next.id}/capture`,{version:next.version});p=r.body;r=await f.send('post',`/work-plans/${p.id}/submit`,{version:p.version,reason:'Again',confirmDocumentOnly:true});assert.equal(r.status,200);p=r.body;
  const v=(await f.agent.get(f.base+`/work-plans/${p.id}/document-review`)).body.review;r=await f.reviewSend(`/work-plans/${p.id}/review`,{version:v.version,submissionHash:v.submission_hash,decision:'accepted',reason:'Document only',confirmDocumentOnly:true});assert.equal(r.status,200,r.text);
 }
 f.db.prepare("UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?").run(f.site,f.manager);assert.equal((await f.send('post','/work-plans',{body:{...body,documentForm:filled('general_machine')}})).status,403);
 }finally{f.db.close();}
});
test('schema49 to50 capability fence preserves legacy request receipts/body/HTML and restores new typed form backup',async()=>{
 const f=await methodFixture(),dir=await mkdtemp(join(tmpdir(),'plan-forms-'));try{
 let r=await f.send('post','/work-plans',{body});let p=r.body;r=await f.send('post',`/work-plans/${p.id}/capture`,{version:p.version});p=r.body;r=await f.send('post',`/work-plans/${p.id}/archive`,{version:p.version});assert.equal(r.status,200);p=r.body;
 const html=(await f.agent.get(f.base+`/work-plans/${p.id}/print`)).text;
 const tables=['work_plans','work_plan_snapshots','work_plan_events','idempotency','audit'];const before=Object.fromEntries(tables.map(t=>[t,f.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));const oldPath=join(dir,'legacy.sqlite');await backup(f.db,oldPath);const old=new DatabaseSync(oldPath);old.exec('PRAGMA user_version=49');old.close();
 const upgraded=openDatabase(oldPath);try{assert.equal(upgraded.prepare('PRAGMA user_version').get()!.user_version,CURRENT_SCHEMA_VERSION);for(const t of tables)assert.deepEqual(upgraded.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),before[t]);const snap=fullWorkPlan(upgraded,getWorkPlan(upgraded,f.site,p.id)).snapshot!;assert.equal(printWorkPlan(snap.body,snap.hash),html);}finally{upgraded.close();}
 r=await f.send('post','/work-plans',{body:{...body,documentForm:filled('excavator_lift')}});assert.equal(r.status,200);const typed=r.body;
 const current=join(dir,'current.sqlite');await backup(f.db,current);const manifest=await createBackup(current,join(dir,'bundle'));assert.equal(manifest.schemaVersion,CURRENT_SCHEMA_VERSION);const restored=await restoreBackup(join(dir,'bundle'),join(dir,'restored'));const db=new DatabaseSync(restored.databasePath);try{assert.equal(db.prepare('SELECT body FROM work_plans WHERE id=?').get(typed.id)!.body,JSON.stringify(typed.body));assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);}finally{db.close();}
 }finally{f.db.close();await rm(dir,{recursive:true,force:true});}
});
test('dedicated controls render blank values/units and actual editor creation choice without source sample defaults',()=>{
 for(const kind of ['general_machine','excavator_lift'] as const){const html=renderToStaticMarkup(createElement(WorkPlanFormFields,{value:blankPlanForm(kind),onChange:()=>{}}));assert.match(html,/자체 문서 완결 조건/);assert.match(html,/단위 미입력/);assert.match(html,/value=""/);assert.doesNotMatch(html,/value="0"/);}
 const html=renderToStaticMarkup(createElement(WorkPlanEditor,{site:{id:'s',name:'Synthetic',role:'manager',version:1},user:{id:'u',name:'Synthetic',email:'s@example.test'},initial:null,onClose:()=>{},onRevision:()=>{},onDirtyChange:()=>{},onBusyChange:()=>{}}));assert.match(html,/새 문서 형식/);assert.match(html,/저장 후 변경 불가/);assert.match(html,/굴착기 중량물 취급 입력형식/);
});
