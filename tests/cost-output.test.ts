import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { costEvidenceFixture } from './fixtures/cost-evidence-fixture.js';
import { boundedCostOutput, outputSelection } from '../server/cost-output.js';
import { CostOutputControl } from '../src/CostOutputControl.js';
test('cost output actual current, historical and baseline prepare; stale and unchanged fixed HTML/business bytes',async()=>{
 const f=await costEvidenceFixture();try{
  const root=f.siteBase+f.base,base=root+'/output';
  let p=await f.agent.get(base+'/prepare');assert.equal(p.status,200,p.text);assert.equal(p.body.status,'current');const initial=p.body.fingerprint;
  let r=await f.agent.get(base+'/print').query({expectedFingerprint:initial});assert.equal(r.status,200,r.text);assert.equal(r.headers['cache-control'],'no-store');assert.match(r.text,/조회 시 현재 금융/);
  await f.expense('<synthetic>');assert.equal((await f.agent.get(base+'/print').query({expectedFingerprint:initial})).status,409);
  const c=(await f.close()).body,closureId=c.current_close_id;
  const b=(await f.send(f.base+'/baselines',{version:c.version,closureId,closureHash:c.currentClosure.hash,memo:'합성 기준본'})).body;
  const oldHtml=(await f.agent.get(root+`/closures/${closureId}/print`)).text;
  const baselineHtml=(await f.agent.get(root+`/baselines/${b.id}/print`)).text;
  p=await f.agent.get(base+'/prepare').query({closureId});assert.equal(p.status,200,p.text);assert.equal(p.body.status,'current');
  const oldFingerprint=p.body.fingerprint;
  assert.equal((await f.send(f.base+'/reopen',{version:c.version,reason:'합성 다시 열기'})).status,200);
  assert.equal((await f.agent.get(base+'/print').query({closureId,expectedFingerprint:oldFingerprint})).status,409);
  const tables=['cost_periods','cost_expenses','cost_closures','cost_baselines','cost_events','idempotency','audit'];const bytes=()=>JSON.stringify(tables.map(t=>f.db.prepare(`SELECT * FROM ${t}`).all()));const before=bytes();
  for(const q of [{closureId},{baselineId:b.id}]){
   p=await f.agent.get(base+'/prepare').query(q);assert.equal(p.status,200,p.text);assert.equal(p.body.status,'historical');
   r=await f.agent.get(base+'/print').query({...q,expectedFingerprint:p.body.fingerprint});assert.equal(r.status,200,r.text);assert.match(r.text,/정상적인 과거 고정 기록/);assert.match(r.text,/&lt;synthetic&gt;/);assert.doesNotMatch(r.text,/<synthetic>/);
  }
  assert.equal(bytes(),before);assert.equal((await f.agent.get(root+`/closures/${closureId}/print`)).text,oldHtml);assert.equal((await f.agent.get(root+`/baselines/${b.id}/print`)).text,baselineHtml);
  // New close does not make the older closure current again.
  const next=await f.close();assert.equal(next.status,200,next.text);p=await f.agent.get(base+'/prepare').query({closureId});assert.equal(p.body.status,'historical');
  p=await f.agent.get(base+'/prepare');assert.equal(p.body.closureId,next.body.current_close_id);assert.equal(p.body.status,'current');
 }finally{f.db.close();}
});
test('cost output target isolation, current manager authority, evidence not conflated, displayed name binds fingerprint',async()=>{
 const f=await costEvidenceFixture();try{
  const base=f.siteBase+f.base+'/output';let p=await f.agent.get(base+'/prepare');const fp=p.body.fingerprint;
  assert.equal((await f.upload()).status,200);p=await f.agent.get(base+'/prepare');assert.equal(p.body.fingerprint,fp,'evidence-only upload is not financial source');
  f.db.prepare('UPDATE sites SET name=? WHERE id=?').run('합성 새 표시',f.site);assert.equal((await f.agent.get(base+'/print').query({expectedFingerprint:fp})).status,409);
  assert.equal((await f.agent.get(base+'/prepare').query({closureId:randomUUID()})).status,404);
  assert.equal((await f.agent.get(base+'/prepare').query({closureId:randomUUID(),baselineId:randomUUID()})).status,400);
  assert.equal((await f.agent.get(base+'/print')).status,400);
  assert.equal((await f.agent.get(base.replace(f.site,randomUUID())+'/prepare')).status,403);
  const other=randomUUID();const source=f.db.prepare('SELECT * FROM cost_periods WHERE id=?').get((await f.current()).id) as Record<string,unknown>;source.id=other;source.month='2026-11';f.db.prepare(`INSERT INTO cost_periods(${Object.keys(source).join(',')}) VALUES(${Object.keys(source).map(()=>'?').join(',')})`).run(...Object.values(source) as (string|number|null)[]);
  const closed=(await f.close()).body;assert.equal((await f.agent.get(f.siteBase+`/cost-periods/${other}/output/prepare`).query({closureId:closed.current_close_id})).status,404);
  f.db.prepare("UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?").run(f.site,f.manager);
  assert.equal((await f.agent.get(base+'/prepare')).status,403);assert.equal((await f.agent.get(base+'/print').query({expectedFingerprint:fp})).status,403);
 }finally{f.db.close();}
});
test('cost output complete byte cap and selector/initial SSR never infer actual printing',()=>{
 const max=4*1024*1024;assert.equal(boundedCostOutput('a'.repeat(max)).length,max);assert.throws(()=>boundedCostOutput('a'.repeat(max+1)));assert.throws(()=>boundedCostOutput('한'.repeat(Math.ceil(max/3))));
 assert.equal(outputSelection.safeParse({}).success,true);assert.equal(outputSelection.safeParse({month:'2026-11'}).success,false);
 const html=renderToStaticMarkup(createElement(CostOutputControl,{base:'/sites/s/cost-periods/p',disabled:true}));assert.match(html,/출력 다시 준비/);assert.match(html,/disabled/);assert.match(html,/과거 마감본은 정상적인 역사 기록/);assert.doesNotMatch(html,/href=|조회 시 현재 금융 자료와 일치/);
});
test('invalid financial source never returns current; original row cap fails whole output',async()=>{
 const f=await costEvidenceFixture();try{
  const item=await f.expense(),base=f.siteBase+f.base+'/output';const before=await f.agent.get(base+'/prepare');
  // Synthetic inconsistent financial data, without disabling product constraints.
  f.db.prepare('UPDATE cost_expenses SET amount=? WHERE id=?').run('999',item.id);
  let r=await f.agent.get(base+'/prepare');assert.equal(r.status,409);assert.equal(r.body.fingerprint,undefined);
  assert.equal((await f.agent.get(base+'/print').query({expectedFingerprint:before.body.fingerprint})).status,409);
  f.db.prepare('UPDATE cost_expenses SET amount=? WHERE id=?').run(item.amount,item.id);
  const row=f.db.prepare('SELECT * FROM cost_expenses WHERE id=?').get(item.id) as Record<string,unknown>;
  const insert=f.db.prepare(`INSERT INTO cost_expenses(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`);
  f.db.exec('BEGIN');for(let i=0;i<1000;i++){row.id=randomUUID();insert.run(...Object.values(row) as (string|number|null)[]);}f.db.exec('COMMIT');
  r=await f.agent.get(base+'/prepare');assert.equal(r.status,400);assert.equal(r.body.fingerprint,undefined);
 }finally{f.db.close();}
});
