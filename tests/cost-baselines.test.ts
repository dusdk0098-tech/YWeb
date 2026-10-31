import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
import { closeReady } from "./fixtures/cost-close-ready.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { baselineCreate, statementCreate } from "../server/cost-baseline-model.js";
test('cost baseline strict inputs distinguish manual statement from delivery claims',()=>{
  assert.equal(statementCreate.safeParse({baselineHash:'a'.repeat(64),submittedDate:'2026-10-28',memo:'manual',correctsId:null,confirmHumanStatement:true}).success,true);
  assert.equal(statementCreate.safeParse({baselineHash:'a'.repeat(64),submittedDate:'2026-02-30',memo:'manual',correctsId:null,confirmHumanStatement:true}).success,false);
  assert.equal(statementCreate.safeParse({baselineHash:'a'.repeat(64),submittedDate:'2026-10-28',memo:'manual',correctsId:null,confirmHumanStatement:true,delivered:true}).success,false);
  assert.equal(baselineCreate.safeParse({version:1,closureId:randomUUID(),closureHash:'bad',memo:'memo'}).success,false);
});
async function fixture() {
  const db=openDatabase(':memory:'),site=randomUUID(),manager=randomUUID(),editor=randomUUID(),origin='http://127.0.0.1:3000',password=randomUUID(),hash=await argon2.hash(password);
  for(const [id,name] of [[manager,'manager'],[editor,'editor']]) db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(id,name+'@example.test',name,hash);
  db.prepare('INSERT INTO sites(id,name) VALUES(?,?)').run(site,'<cost-site>');
  for(const [id,role] of [[manager,'manager'],[editor,'editor']]) db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(site,id,role);
  const app=await createApp(db,{origin,secret:'b'.repeat(48)});
  async function login(name:string) {const agent=request.agent(app);const s=await agent.get('/api/session');const r=await agent.post('/api/login').set('Origin',origin).set('x-csrf-token',s.body.csrf).send({email:name+'@example.test',password});assert.equal(r.status,200);return {agent,csrf:r.body.csrf as string};}
  const m=await login('manager'),ed=await login('editor'),base=`/api/sites/${site}/cost-periods`;
  const post=(path:string,body:object,key=randomUUID())=>m.agent.post(base+path).set('Origin',origin).set('x-csrf-token',m.csrf).set('idempotency-key',key).send(body);
  const put=(path:string,body:object)=>m.agent.put(base+path).set('Origin',origin).set('x-csrf-token',m.csrf).set('idempotency-key',randomUUID()).send(body);
  const get=(path:string)=>m.agent.get(base+path);
  return {db,site,base,m,ed,post,put,get};
}
test('real app close baseline statement reopen exact changes reclose and independent new baseline',async()=>{
  const {db,post,put,get}=await fixture();
  try {
    let r=await post('',{month:'2026-10',openingNote:'manual opening',categories:[{label:'same name',plan:'10',opening:'0.1'},{label:'other',plan:'20',opening:'0.2'}]});assert.equal(r.status,200,r.text);let p=r.body;const id=p.id;
    r=await post(`/${id}/expenses`,{version:p.version,expense:{categoryId:p.categories[0].id,spendDate:'2026-10-02',description:'<script>same title</script>',quantity:'0.3',unitPriceWon:'1'}});assert.equal(r.status,200,r.text);p=r.body.period;const expense=r.body.expense;
    closeReady(db);r=await post(`/${id}/close`,{version:p.version,reason:'close one'});assert.equal(r.status,200,r.text);p=r.body;
    const original=(await get(`/${id}/closures/${p.current_close_id}/print`)).text,closureBody=db.prepare('SELECT body FROM cost_closures WHERE id=?').get(p.current_close_id)!.body;
    const create={version:p.version,closureId:p.current_close_id,closureHash:p.currentClosure.hash,memo:'<baseline>'},key=randomUUID();
    r=await post(`/${id}/baselines`,create,key);assert.equal(r.status,200,r.text);const b=r.body;
    assert.equal((await post(`/${id}/baselines`,create,key)).body.id,b.id);
    assert.equal((await post(`/${id}/baselines`,create)).status,409);
    const baselinePrint=(await get(`/${id}/baselines/${b.id}/print`)).text;assert.ok(baselinePrint.includes('&lt;baseline&gt;'));assert.ok(!baselinePrint.includes('<script>'));
    let compare=await get(`/${id}/baselines/${b.id}/compare`);assert.equal(compare.body.available,true,compare.text);assert.equal(compare.body.changed,false);
    const statement={baselineHash:b.hash,submittedDate:'2026-10-20',memo:'human says submitted <x>',correctsId:null,confirmHumanStatement:true};
    r=await post(`/${id}/baselines/${b.id}/statements`,statement);assert.equal(r.status,200,r.text);const first=r.body;
    const statementPrint=(await get(`/${id}/baselines/${b.id}/statements/${first.body.id}/print`)).text;
    assert.ok(statementPrint.includes('외부 전송·접수·열람 증명이 아닙니다.'));
    r=await post(`/${id}/baselines/${b.id}/statements`,{...statement,correctsId:first.body.id,submittedDate:'2026-10-21',memo:'date correction'});assert.equal(r.status,200,r.text);assert.equal(r.body.body.number,2);
    assert.equal((await get(`/${id}/baselines/${b.id}/statements/${first.body.id}/print`)).text,statementPrint);
    r=await post(`/${id}/reopen`,{version:p.version,reason:'correct ledger'});assert.equal(r.status,200,r.text);p=r.body;
    assert.equal((await post(`/${id}/baselines`,{...create,version:p.version})).status,409);
    r=await put(`/${id}/expenses/${expense.id}`,{version:p.version,reason:'exact difference',expense:{categoryId:p.categories[1].id,spendDate:'2026-10-03',description:'same title',quantity:'0.300001',unitPriceWon:'1'}});assert.equal(r.status,200,r.text);p=r.body.period;
    r=await put(`/${id}/budget`,{version:p.version,reason:'plan correction',plans:p.categories.map((c:{id:string},i:number)=>({categoryId:c.id,plan:i?'20':'10.000001'})),openings:p.categories.map((c:{id:string},i:number)=>({categoryId:c.id,opening:i?'0.2':'0.100001'}))});assert.equal(r.status,200,r.text);p=r.body;
    compare=await get(`/${id}/baselines/${b.id}/compare`);assert.equal(compare.body.available,true);assert.ok(compare.body.changes.some((x:{kind:string;field:string;delta:string})=>x.kind==='expense'&&x.field==='amount'&&x.delta==='0.000001'));
    assert.ok(compare.body.changes.some((x:{field:string})=>x.field==='category_id'));
    assert.ok(compare.body.changes.some((x:{kind:string;field:string;delta:string})=>x.kind==='category'&&x.field==='opening'&&x.delta==='0.000001'));
    closeReady(db);r=await post(`/${id}/close`,{version:p.version,reason:'close two'});assert.equal(r.status,200,r.text);p=r.body;
    r=await post(`/${id}/baselines`,{version:p.version,closureId:p.current_close_id,closureHash:p.currentClosure.hash,memo:'new baseline'});assert.equal(r.status,200,r.text);assert.notEqual(r.body.id,b.id);const second=r.body;
    assert.equal((await get(`/${id}/baselines/${second.id}/compare`)).body.changed,false);
    assert.equal((await get(`/${id}/baselines/${second.id}/statements`)).body.items.length,0);
    assert.equal((await get(`/${id}/baselines/${b.id}/print`)).text,baselinePrint);
    assert.equal((await get(`/${id}/closures/${b.body.closureId}/print`)).text,original);
    assert.equal(db.prepare('SELECT body FROM cost_closures WHERE id=?').get(b.body.closureId)!.body,closureBody);
    assert.equal((await get(`/${id}/baselines/${b.id}/export`)).body.hash,b.hash);
    assert.throws(()=>db.prepare('UPDATE cost_baselines SET hash=? WHERE id=?').run('x',b.id));
    assert.throws(()=>db.prepare('DELETE FROM cost_baseline_statements WHERE id=?').run(first.body.id));
  }finally{db.close();}
});
test('baseline comparison preserves split ancestry even when exact total stays equal',async()=>{
  const {db,post,get}=await fixture();try{
    let r=await post('',{month:'2026-10',openingNote:'opening',categories:[{label:'a',plan:'10',opening:'0'}]});let p=r.body;const id=p.id;
    r=await post(`/${id}/expenses`,{version:p.version,expense:{categoryId:p.categories[0].id,spendDate:'2026-10-01',description:'same',quantity:'1',unitPriceWon:'1'}});p=r.body.period;const expense=r.body.expense;
    closeReady(db);r=await post(`/${id}/close`,{version:p.version,reason:'close'});p=r.body;
    r=await post(`/${id}/baselines`,{version:p.version,closureId:p.current_close_id,closureHash:p.currentClosure.hash,memo:'before split'});assert.equal(r.status,200,r.text);const b=r.body;
    r=await post(`/${id}/reopen`,{version:p.version,reason:'split'});p=r.body;
    r=await post(`/${id}/expenses/${expense.id}/split`,{version:p.version,reason:'split exact',children:[{description:'same',quantity:'0.3',unitPriceWon:'1'},{description:'same',quantity:'0.7',unitPriceWon:'1'}]});assert.equal(r.status,200,r.text);
    const cmp=await get(`/${id}/baselines/${b.id}/compare`);assert.equal(cmp.body.available,true,cmp.text);assert.ok(cmp.body.changes.some((x:{kind:string;field:string})=>x.kind==='split'&&x.field==='added'));assert.equal(cmp.body.changes.filter((x:{kind:string;field:string})=>x.kind==='totals'&&x.field==='current').length,0);
  }finally{db.close();}
});
test('baseline unavailable is distinct from no changes and ordinary role/hash/idempotency checks',async()=>{
  const {db,base,post,get,ed}=await fixture();try{
    let r=await post('',{month:'2026-10',openingNote:'opening',categories:[{label:'a',plan:'10',opening:'0'}]});let p=r.body;const id=p.id;
    closeReady(db);r=await post(`/${id}/close`,{version:p.version,reason:'close'});p=r.body;
    const v={version:p.version,closureId:p.current_close_id,closureHash:p.currentClosure.hash,memo:'fixed'};
    assert.equal((await post(`/${id}/baselines`,{...v,closureHash:'0'.repeat(64)})).status,409);
    db.exec("CREATE TRIGGER baseline_test_abort BEFORE INSERT ON cost_baselines BEGIN SELECT RAISE(ABORT,'ordinary insert failure'); END;");
    assert.equal((await post(`/${id}/baselines`,v)).status,500);assert.equal(db.prepare('SELECT count(*) n FROM cost_baselines').get()!.n,0);db.exec('DROP TRIGGER baseline_test_abort');
    const key=randomUUID();r=await post(`/${id}/baselines`,v,key);assert.equal(r.status,200,r.text);const b=r.body;
    assert.equal((await post(`/${id}/baselines`,{...v,memo:'different'},key)).status,409);
    assert.equal((await ed.agent.get(base+`/${id}/baselines`)).status,403);
    assert.equal((await get(`/${id}/baselines/${randomUUID()}/compare`)).status,404);
    r=await post(`/${id}/baselines/${b.id}/statements`,{baselineHash:b.hash,submittedDate:'2026-10-20',memo:'wrong correction target',correctsId:randomUUID(),confirmHumanStatement:true});assert.equal(r.status,400);
    r=await post(`/${id}/reopen`,{version:p.version,reason:'ordinary malformed-data fixture'});p=r.body;
    // Synthetic persisted-data error, not an original guard race/security review.
    db.prepare('UPDATE cost_periods SET categories=? WHERE id=?').run(JSON.stringify([{...p.categories[0],plan:'invalid'}]),id);
    r=await get(`/${id}/baselines/${b.id}/compare`);assert.equal(r.status,200,r.text);assert.equal(r.body.available,false);assert.equal('changed' in r.body,false);assert.equal('changes' in r.body,false);
    assert.equal((await get(`/${id}/baselines/${b.id}/print`)).status,200);
  }finally{db.close();}
});
test('exact 1000 retained cost rows produce full baseline; 1001 fails comparison instead of no changes',async()=>{
 const {db,site,post,get}=await fixture();try{
  let r=await post('',{month:'2026-10',openingNote:'cap fixture',categories:[{label:'a',plan:'1000',opening:'0'}]});let p=r.body;const id=p.id;
  const actor=db.prepare("SELECT user_id FROM memberships WHERE site_id=? AND role='manager'").get(site)!.user_id;
  const insert=db.prepare("INSERT INTO cost_expenses VALUES(?,?,?,?,?,?,?,?, 'active',1,?,?,?)");
  for(let i=0;i<1000;i++)insert.run(randomUUID(),id,p.categories[0].id,'2026-10-01',`expense-${i}`,'0.000001','1','0.000001',actor,'2026-10-01','2026-10-01');
  closeReady(db);r=await post(`/${id}/close`,{version:p.version,reason:'full retained ledger'});assert.equal(r.status,200,r.text);p=r.body;
  r=await post(`/${id}/baselines`,{version:p.version,closureId:p.current_close_id,closureHash:p.currentClosure.hash,memo:'all 1000 rows'});assert.equal(r.status,200,r.text);const b=r.body;
  assert.equal(b.body.closure.expenses.length,1000);assert.equal(b.body.closure.totals.total.current,'0.001');
  assert.equal((await get(`/${id}/baselines/${b.id}/compare`)).body.changed,false);
  const html=await get(`/${id}/baselines/${b.id}/print`);assert.ok(html.text.includes('expense-999'));
  r=await post(`/${id}/reopen`,{version:p.version,reason:'cap overflow synthetic fixture'});assert.equal(r.status,200);p=r.body;
  insert.run(randomUUID(),id,p.categories[0].id,'2026-10-01','overflow','0.000001','1','0.000001',actor,'2026-10-01','2026-10-01');
  r=await get(`/${id}/baselines/${b.id}/compare`);assert.equal(r.status,200,r.text);assert.equal(r.body.available,false);assert.equal('changed' in r.body,false);
  closeReady(db);assert.equal((await post(`/${id}/close`,{version:p.version,reason:'must not truncate'})).status,400);
  assert.equal((await get(`/${id}/baselines/${b.id}/print`)).text,html.text);
 }finally{db.close();}
});
test('schema37 closures stay unlabelled and byte-identical; schema38 backup restores baselines and statements',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{join}=await import('node:path'),{tmpdir}=await import('node:os'),{backup,DatabaseSync}=await import('node:sqlite'),{createBackup,restoreBackup}=await import('../scripts/local-backup.js'),{printCostPeriod}=await import('../server/cost-print.js');
 const {db,post,get}=await fixture(),dir=await mkdtemp(join(tmpdir(),'cost-baselines-'));try{
  let r=await post('',{month:'2026-10',openingNote:'legacy',categories:[{label:'a',plan:'1',opening:'0'}]});let p=r.body;const id=p.id;
  closeReady(db);r=await post(`/${id}/close`,{version:p.version,reason:'legacy closed'});p=r.body;
  const original=db.prepare('SELECT * FROM cost_closures WHERE id=?').get(p.current_close_id),html=(await get(`/${id}/closures/${p.current_close_id}/print`)).text;
  const oldFile=join(dir,'prior.sqlite');await backup(db,oldFile);const old=new DatabaseSync(oldFile);old.exec('DROP TABLE IF EXISTS education_archive_attachments; DROP TABLE IF EXISTS education_attachment_events; DROP TABLE IF EXISTS education_attachments; DROP TABLE IF EXISTS cost_close_evidence; DROP TABLE IF EXISTS cost_evidence_events; DROP TABLE IF EXISTS cost_evidence_links; DROP TABLE IF EXISTS cost_evidence_files; DROP TABLE IF EXISTS cost_expense_preset_sources; DROP TABLE IF EXISTS cost_input_presets; DROP TABLE IF EXISTS stock_minimum_events; DROP TABLE IF EXISTS daily_monthly_records; DROP TABLE IF EXISTS work_plan_attachment_events; DROP TABLE IF EXISTS work_plan_attachments; DROP TABLE IF EXISTS minutes_attachment_events; DROP TABLE IF EXISTS minutes_attachments; DROP TABLE IF EXISTS inspection_template_use_stops; DROP TABLE IF EXISTS education_catalog_use_stops; DROP TABLE cost_baseline_statements; DROP TABLE cost_baselines; PRAGMA user_version=37');old.close();
  const migrated=openDatabase(oldFile);try{
   assert.equal(migrated.prepare('PRAGMA user_version').get()!.user_version,CURRENT_SCHEMA_VERSION);assert.deepEqual(migrated.prepare('SELECT * FROM cost_closures WHERE id=?').get(p.current_close_id),original);assert.equal(migrated.prepare('SELECT count(*) n FROM cost_baselines').get()!.n,0);assert.equal(migrated.prepare('SELECT count(*) n FROM cost_baseline_statements').get()!.n,0);assert.equal(printCostPeriod(JSON.parse(String(original!.body)),String(original!.hash)),html);
  }finally{migrated.close();}
  r=await post(`/${id}/baselines`,{version:p.version,closureId:p.current_close_id,closureHash:p.currentClosure.hash,memo:'backup baseline'});assert.equal(r.status,200);const b=r.body;
  r=await post(`/${id}/baselines/${b.id}/statements`,{baselineHash:b.hash,submittedDate:'2026-10-28',memo:'synthetic statement',correctsId:null,confirmHumanStatement:true});assert.equal(r.status,200);
  const tables=['cost_periods','cost_expenses','cost_closures','cost_baselines','cost_baseline_statements'],rows=Object.fromEntries(tables.map(t=>[t,db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
  const file=join(dir,'current.sqlite');await backup(db,file);await createBackup(file,join(dir,'bundle'));const restored=await restoreBackup(join(dir,'bundle'),join(dir,'restore')),check=new DatabaseSync(restored.databasePath);try{assert.equal(check.prepare('PRAGMA user_version').get()!.user_version,CURRENT_SCHEMA_VERSION);for(const t of tables)assert.deepEqual(check.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),rows[t]);assert.deepEqual(check.prepare('PRAGMA foreign_key_check').all(),[]);}finally{check.close();}
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
test('manual statements are paginated actual rows and bounded at 1000 without truncating stored history',async()=>{
 const {db,post,get}=await fixture();try{
  const {journalHash}=await import('../server/daily-journal-sources.js');
  let r=await post('',{month:'2026-10',openingNote:'opening',categories:[{label:'a',plan:'1',opening:'0'}]});let p=r.body;const id=p.id;
  closeReady(db);p=(await post(`/${id}/close`,{version:p.version,reason:'close'})).body;
  r=await post(`/${id}/baselines`,{version:p.version,closureId:p.current_close_id,closureHash:p.currentClosure.hash,memo:'statements'});const b=r.body;
  const input={baselineHash:b.hash,submittedDate:'2026-10-28',memo:'statement',correctsId:null,confirmHumanStatement:true};
  r=await post(`/${id}/baselines/${b.id}/statements`,input);assert.equal(r.status,200);const first=r.body.body;
  const insert=db.prepare('INSERT INTO cost_baseline_statements VALUES(?,?,?,?,?,?,?)');
  for(let n=2;n<=1000;n++){const body={...first,id:randomUUID(),number:n,memo:`synthetic-${n}`};insert.run(body.id,b.id,n,null,JSON.stringify(body),journalHash(body),body.recordedAt);}
  const a=await get(`/${id}/baselines/${b.id}/statements?offset=0`),z=await get(`/${id}/baselines/${b.id}/statements?offset=950`);
  assert.equal(a.body.items.length,50);assert.equal(a.body.hasMore,true);assert.equal(a.body.items[0].body.number,1000);assert.equal(z.body.items.length,50);assert.equal(z.body.hasMore,false);assert.equal(z.body.items[49].body.id,first.id);
  assert.equal((await post(`/${id}/baselines/${b.id}/statements`,input)).status,409);assert.equal(db.prepare('SELECT count(*) n FROM cost_baseline_statements').get()!.n,1000);
 }finally{db.close();}
});
