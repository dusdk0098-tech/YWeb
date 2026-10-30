import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { previewEducationContent, educationImportInput, contentExport, EDUCATION_TRANSFER_BYTES } from "../server/education-transfer-model.js";
const body={title:'<own content>',categoryLabel:'self-defined label',objectives:'objective',contents:'Own synthetic content'};
const file=(records:object[]= [body])=>JSON.stringify({format:'pedit-own-education-content',schemaVersion:1,records});
test('education transfer fixed schema strict exclusions digest and exact UTF8 cap',()=>{
 const text=file(),a=previewEducationContent({text}),b=previewEducationContent({text:text+' '});assert.notEqual(a.digest,b.digest);assert.deepEqual(a.rows,b.rows);
 for(const key of ['id','status','approved','participants','legalCourseCode','referenceNote'])assert.throws(()=>previewEducationContent({text:file([{...body,[key]:'forbidden'}])}));
 assert.throws(()=>previewEducationContent({text:JSON.stringify({format:'pedit-own-education-content',schemaVersion:2,records:[body]})}));
 assert.throws(()=>previewEducationContent({text:'{invalid'}));assert.throws(()=>previewEducationContent({text:file([])}));assert.throws(()=>previewEducationContent({text:file(Array(21).fill(body))}));
 const capped=text+' '.repeat(EDUCATION_TRANSFER_BYTES-Buffer.byteLength(text));assert.equal(previewEducationContent({text:capped}).bytes,EDUCATION_TRANSFER_BYTES);assert.throws(()=>previewEducationContent({text:capped+' '}));
 assert.throws(()=>previewEducationContent({text:file([{...body,contents:'가'.repeat(10001)}])}));
 assert.throws(()=>contentExport(Array(20).fill({...body,contents:'가'.repeat(10000)})));
 const duplicated=previewEducationContent({text:file([body,body])});assert.deepEqual(duplicated.rows[0].duplicateIndexes,[1]);
 assert.equal(educationImportInput.safeParse({text,previewDigest:a.digest,selectedIndexes:[0,0],declareRights:true}).success,false);
 assert.equal(educationImportInput.safeParse({text,previewDigest:a.digest,selectedIndexes:[0],declareRights:false}).success,false);
});
async function fixture(){
 const db=openDatabase(':memory:'),site=randomUUID(),manager=randomUUID(),editor=randomUUID(),origin='http://127.0.0.1:3000',password=randomUUID(),hash=await argon2.hash(password);
 db.prepare('INSERT INTO sites(id,name) VALUES(?,?)').run(site,'synthetic site');
 for(const [id,name] of [[manager,'manager'],[editor,'editor']]){db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(id,name+'@example.test',name,hash);db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(site,id,name);}
 const app=await createApp(db,{origin,secret:'t'.repeat(48)});
 async function login(name:string){const agent=request.agent(app),s=await agent.get('/api/session'),r=await agent.post('/api/login').set('Origin',origin).set('x-csrf-token',s.body.csrf).send({email:name+'@example.test',password});assert.equal(r.status,200);return{agent,csrf:r.body.csrf as string};}
 const m=await login('manager'),ed=await login('editor'),base=`/api/sites/${site}`;
 const post=(path:string,value:object,key=randomUUID())=>m.agent.post(base+path).set('Origin',origin).set('x-csrf-token',m.csrf).set('idempotency-key',key).send(value);
 return{db,site,manager,base,m,ed,post};
}
test('real app preview is read-only; explicit selection imports atomic new unpublished drafts, never merges titles',async()=>{
 const f=await fixture();try{
  const path='/education-content-transfer',text=file([body,body,{...body,title:'third'}]);
  const counts=()=>['education_catalog','education_sessions','education_participants','audit','idempotency'].map(t=>f.db.prepare(`SELECT count(*) n FROM ${t}`).get()!.n);
  const before=counts();let r=await f.post(path+'/preview',{text});assert.equal(r.status,200,r.text);assert.deepEqual(counts(),before);const preview=r.body;
  const command={text,previewDigest:preview.digest,selectedIndexes:[1,0],declareRights:true},key=randomUUID();
  assert.equal((await f.post(path+'/import',{...command,text:text+' '})).status,409);
  assert.equal((await f.post(path+'/import',{...command,selectedIndexes:[3]})).status,400);assert.deepEqual(counts(),before);
  r=await f.post(path+'/import',command,key);assert.equal(r.status,200,r.text);assert.equal(r.body.created.length,2);const created=r.body.created;
  assert.notEqual(created[0].id,created[1].id);assert.deepEqual((await f.post(path+'/import',command,key)).body,r.body);
  for(const row of created){const stored=f.db.prepare('SELECT * FROM education_catalog WHERE id=?').get(row.id)!;assert.equal(stored.status,'draft');assert.equal(stored.version,1);assert.equal(stored.parent_id,null);assert.equal(stored.published_snapshot,null);assert.deepEqual(JSON.parse(String(stored.body)),{...body,referenceNote:''});}
  assert.equal(f.db.prepare('SELECT count(*) n FROM education_sessions').get()!.n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM education_participants').get()!.n,0);
  r=await f.post(path+'/import',command);assert.equal(r.status,200,r.text);assert.notEqual(r.body.created[0].id,created[0].id);assert.equal(f.db.prepare('SELECT count(*) n FROM education_catalog').get()!.n,4);
  const marker=counts();f.db.exec("CREATE TRIGGER transfer_test_abort BEFORE INSERT ON education_catalog WHEN json_extract(NEW.body,'$.title')='third' BEGIN SELECT RAISE(ABORT,'synthetic second-row failure'); END;");
  r=await f.post(path+'/import',{...command,selectedIndexes:[0,2]});assert.equal(r.status,500);assert.deepEqual(counts(),marker);
  assert.equal((await f.ed.agent.get(f.base+path+'/candidates')).status,403);
 }finally{f.db.close();}
});
test('manager export stopped content only four fields, reimport has no stop/publication/participant inheritance',async()=>{
 const f=await fixture();try{
  let r=await f.post('/education-catalog',{body:{...body,referenceNote:'private reference excluded'}});assert.equal(r.status,200,r.text);let source=r.body;
  r=await f.post(`/education-catalog/${source.id}/publish`,{version:source.version});assert.equal(r.status,200,r.text);source=r.body;
  const original=f.db.prepare('SELECT * FROM education_catalog WHERE id=?').get(source.id);
  r=await f.post(`/education-catalog/${source.id}/stop-use`,{version:source.version,sourceHash:source.published_hash,reason:'new use stopped',confirmNoUndo:true});assert.equal(r.status,200,r.text);
  const stop=f.db.prepare('SELECT * FROM education_catalog_use_stops WHERE catalog_id=?').get(source.id);
  const page=await f.m.agent.get(f.base+'/education-content-transfer/candidates');assert.equal(page.status,200);assert.equal(page.body.items[0].useStopped,true);assert.equal('actor' in page.body.items[0],false);
  const selection={selections:[{id:source.id,version:source.version}],declareRights:true};
  r=await f.post('/education-content-transfer/export',selection);assert.equal(r.status,200,r.text);assert.deepEqual(r.body,JSON.parse(file()));
  assert.ok(!r.text.includes('private reference'));assert.ok(!r.text.includes(source.id));assert.ok(!r.text.includes(f.manager));
  assert.equal((await f.post('/education-content-transfer/export',{...selection,selections:[{id:source.id,version:source.version-1}]})).status,409);
  const text=r.text,p=await f.post('/education-content-transfer/preview',{text});r=await f.post('/education-content-transfer/import',{text,previewDigest:p.body.digest,selectedIndexes:[0],declareRights:true});assert.equal(r.status,200,r.text);
  const fresh=f.db.prepare('SELECT * FROM education_catalog WHERE id=?').get(r.body.created[0].id)!;assert.equal(fresh.status,'draft');assert.equal(fresh.parent_id,null);assert.equal(f.db.prepare('SELECT count(*) n FROM education_catalog_use_stops WHERE catalog_id=?').get(fresh.id)!.n,0);
  assert.deepEqual(f.db.prepare('SELECT * FROM education_catalog WHERE id=?').get(source.id),original);assert.deepEqual(f.db.prepare('SELECT * FROM education_catalog_use_stops WHERE catalog_id=?').get(source.id),stop);
  assert.equal(f.db.prepare('SELECT count(*) n FROM education_catalog_links').get()!.n,0);
 }finally{f.db.close();}
});
test('twenty selected records import fully; all-or-nothing invalid row and out-of-site export',async()=>{
 const f=await fixture();try{
  const text=file(Array.from({length:20},(_,i)=>({...body,title:`own-${i}`}))),p=await f.post('/education-content-transfer/preview',{text});assert.equal(p.status,200);
  const r=await f.post('/education-content-transfer/import',{text,previewDigest:p.body.digest,selectedIndexes:Array.from({length:20},(_,i)=>i),declareRights:true});assert.equal(r.status,200,r.text);assert.equal(r.body.created.length,20);
  assert.equal((await f.post('/education-content-transfer/preview',{text:file([body,{...body,status:'published'}])})).status,400);assert.equal(f.db.prepare('SELECT count(*) n FROM education_catalog').get()!.n,20);
  const other=randomUUID();f.db.prepare('INSERT INTO sites(id,name) VALUES(?,?)').run(other,'other');const id=randomUUID();f.db.prepare("INSERT INTO education_catalog VALUES(?,?,NULL,?,'draft',1,NULL,NULL,'now','now')").run(id,other,JSON.stringify({...body,referenceNote:''}));
  assert.equal((await f.post('/education-content-transfer/export',{selections:[{id,version:1}],declareRights:true})).status,404);
 }finally{f.db.close();}
});
test('actual candidate pages and exact 120KiB preview stay read-only; export size failure never truncates',async()=>{
 const f=await fixture();try{
  const insert=f.db.prepare("INSERT INTO education_catalog VALUES(?,?,NULL,?,'draft',1,NULL,NULL,?,?)");
  for(let n=0;n<51;n++)insert.run(randomUUID(),f.site,JSON.stringify({...body,title:`row-${n}`,referenceNote:''}),`2026-10-28T00:00:${String(n).padStart(2,'0')}Z`,'now');
  const a=await f.m.agent.get(f.base+'/education-content-transfer/candidates?offset=0'),b=await f.m.agent.get(f.base+'/education-content-transfer/candidates?offset=50');assert.equal(a.status,200);assert.equal(a.body.items.length,50);assert.equal(a.body.hasMore,true);assert.equal(b.body.items.length,1);assert.equal(b.body.hasMore,false);assert.ok(!a.body.items.some((x:{id:string})=>x.id===b.body.items[0].id));
  const text=file(),capped=text+' '.repeat(EDUCATION_TRANSFER_BYTES-Buffer.byteLength(text)),counts=()=>['education_catalog','audit','idempotency'].map(t=>f.db.prepare(`SELECT count(*) n FROM ${t}`).get()!.n),before=counts();
  let r=await f.post('/education-content-transfer/preview',{text:capped});assert.equal(r.status,200,r.text);assert.equal(r.body.bytes,EDUCATION_TRANSFER_BYTES);assert.equal((await f.post('/education-content-transfer/preview',{text:capped+' '})).status,400);
  r=await f.post('/education-content-transfer/export',{selections:[{id:a.body.items[0].id,version:1}],declareRights:true});assert.equal(r.status,200,r.text);assert.deepEqual(counts(),before);
  const large=[];for(let n=0;n<20;n++){const id=randomUUID();insert.run(id,f.site,JSON.stringify({...body,contents:'가'.repeat(10000),referenceNote:''}),'now','now');large.push({id,version:1});}
  r=await f.post('/education-content-transfer/export',{selections:large,declareRights:true});assert.equal(r.status,400,r.text);assert.ok(!r.body.records);assert.equal(f.db.prepare('SELECT count(*) n FROM education_catalog').get()!.n,71);
 }finally{f.db.close();}
});
