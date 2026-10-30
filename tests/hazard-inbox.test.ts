import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createApp } from "../server/app.js";
import { costEvidenceFixture } from "./fixtures/cost-evidence-fixture.js";
import { hazardInboxQuery, readHazardInbox, serializeHazardInbox, type HazardInbox } from "../server/hazard-inbox.js";
import { HazardsPanel } from "../src/HazardsPanel.js";
import { HazardInboxPanel } from "../src/HazardInboxPanel.js";
const body={title:'<합성 신고>',observedDate:'2026-10-28',location:'합성 장소',description:'PRIVATE DESCRIPTION'};
test("hazard inbox real lifecycle current assignment self review roles and business read immutability",async()=>{
 const f=await costEvidenceFixture();try{
  const endpoint=f.siteBase+'/hazard-inbox';
  let r=await f.send('/hazards',body);assert.equal(r.status,200,r.text);let record=r.body;
  assert.equal((await f.agent.get(endpoint)).body.total,0);
  r=await f.send(`/hazards/${record.id}/submit`,{version:record.version});assert.equal(r.status,200,r.text);record=r.body;
  assert.equal((await f.agent.get(endpoint)).body.total,0);
  r=await f.send(`/hazards/${record.id}/assign`,{version:record.version,assigneeId:f.manager,dueDate:'2026-10-29',reason:'합성 배정'});assert.equal(r.status,200,r.text);record=r.body;
  r=await f.agent.get(endpoint);assert.equal(r.status,200);assert.equal(r.body.total,1);assert.equal(r.body.items[0].canReport,true);assert.doesNotMatch(r.text,/PRIVATE DESCRIPTION|submitted_snapshot|remediation|attachments/);
  f.db.prepare("UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?").run(f.site,f.manager);
  r=await f.agent.get(endpoint);assert.equal(r.body.total,1);assert.equal(r.body.items[0].canReport,false);assert.equal((await f.agent.get(endpoint).query({kind:'reviews'})).status,403);
  assert.equal((await f.send(`/hazards/${record.id}/remediate`,{version:record.version,text:'not allowed'})).status,403);
  f.db.prepare("UPDATE memberships SET role='manager' WHERE site_id=? AND user_id=?").run(f.site,f.manager);
  r=await f.send(`/hazards/${record.id}/remediate`,{version:record.version,text:'합성 제출'});assert.equal(r.status,200,r.text);record=r.body;
  r=await f.agent.get(endpoint);assert.equal(r.body.items[0].stateLabel,'다른 관리자 검토 대기');assert.equal(r.body.items[0].canClose,false);assert.equal(r.body.items[0].canReturn,true);
  assert.equal((await f.agent.get(endpoint).query({kind:'reviews'})).body.total,0);
  assert.equal((await f.send(`/hazards/${record.id}/close`,{version:record.version,reason:'본인 종결 불가'})).status,403);
  const other=randomUUID(),pass=randomUUID(),origin='http://127.0.0.1:3000';
  f.db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(other,'inbox@example.test','합성 담당',await argon2.hash(pass));f.db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(f.site,other,'editor');
  r=await f.send(`/hazards/${record.id}/assign`,{version:record.version,assigneeId:other,dueDate:'2026-10-30',reason:'합성 재배정'});assert.equal(r.status,200,r.text);record=r.body;
  assert.equal((await f.agent.get(endpoint)).body.total,0);
  const app=await createApp(f.db,{origin,secret:'synthetic-evidence'.repeat(4)}),agent=request.agent(app);r=await agent.get('/api/session');r=await agent.post('/api/login').set('Origin',origin).set('x-csrf-token',r.body.csrf).send({email:'inbox@example.test',password:pass});const csrf=r.body.csrf;
  r=await agent.post(f.siteBase+`/hazards/${record.id}/remediate`).set('Origin',origin).set('x-csrf-token',csrf).set('idempotency-key',randomUUID()).send({version:record.version,text:'다른 담당 제출'});assert.equal(r.status,200,r.text);record=r.body;
  const tables=['hazard_reports','hazard_events','audit','idempotency'];const snapshot=()=>JSON.stringify(tables.map(t=>f.db.prepare(`SELECT * FROM ${t}`).all()));const before=snapshot();
  r=await f.agent.get(endpoint).query({kind:'reviews'});assert.equal(r.status,200,r.text);assert.equal(r.body.total,1);assert.equal(r.body.items[0].canClose,true);assert.equal(r.headers['cache-control'],'no-store');assert.equal(snapshot(),before);
  // Current detail is re-read; no action is authorized by an earlier inbox projection.
  assert.equal((await f.agent.get(f.siteBase+`/hazards/${record.id}`)).body.version,record.version);
  f.db.prepare("UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?").run(f.site,other);
  r=await f.agent.get(endpoint).query({kind:'reviews'});assert.equal(r.body.items[0].canReturn,false);assert.equal(r.body.items[0].canClose,true);
  r=await f.send(`/hazards/${record.id}/close`,{version:record.version,reason:'다른 관리자 종결'});assert.equal(r.status,200,r.text);record=r.body;assert.equal((await f.agent.get(endpoint).query({kind:'reviews'})).body.total,0);
  r=await f.send(`/hazards/${record.id}/reopen`,{version:record.version,assigneeId:f.manager,dueDate:'2026-10-31',reason:'합성 재개'});assert.equal(r.status,200,r.text);assert.equal((await f.agent.get(endpoint)).body.total,1);
  assert.equal((await f.agent.get(endpoint).query({userId:other})).status,400);
  assert.equal((await f.agent.get(`/api/sites/${randomUUID()}/hazard-inbox`)).status,403);
 }finally{f.db.close();}
});
test("inbox stable fifty-row pages count scoped current matches and malformed page fails entirely",async()=>{
 const f=await costEvidenceFixture();try{
  const insert=f.db.prepare("INSERT INTO hazard_reports(id,site_id,owner_id,body,status,version,assignee_id,due_date,created_at,updated_at) VALUES(?,?,?,?,'assigned',1,?,'2026-10-29',?,?)");
  for(let i=0;i<101;i++)insert.run(`synthetic-${String(i).padStart(3,'0')}`,f.site,f.manager,JSON.stringify(body),f.manager,'same','same');
  const q=hazardInboxQuery.parse({});const a=readHazardInbox(f.db,f.site,f.manager,'manager',q),b=readHazardInbox(f.db,f.site,f.manager,'manager',{...q,offset:50}),c=readHazardInbox(f.db,f.site,f.manager,'manager',{...q,offset:100});
  assert.equal(a.total,101);assert.equal(a.items.length,50);assert.equal(a.hasMore,true);assert.equal(b.items.length,50);assert.equal(c.items.length,1);assert.equal(c.hasMore,false);assert.equal(new Set([...a.items,...b.items,...c.items].map(i=>i.id)).size,101);assert.equal(a.items[0].id,'synthetic-100');
  // Insert an intentionally malformed synthetic row; do not weaken the immutable-body trigger.
  insert.run('synthetic-zzz',f.site,f.manager,'not json',f.manager,'same','same');
  const r=await f.agent.get(f.siteBase+'/hazard-inbox');assert.equal(r.status,409);assert.equal(r.body.total,undefined);assert.equal(r.body.items,undefined);
 }finally{f.db.close();}
});
test("inbox query and complete 256KiB serialization bounds",()=>{
 for(const q of [{kind:'all'},{offset:-1},{offset:1000001},{actor:'x'}])assert.equal(hazardInboxQuery.safeParse(q).success,false);
 const base:HazardInbox={siteId:'s',kind:'mine',offset:0,total:0,hasMore:false,retrievedAt:'',items:[]};
 const budget=256*1024-Buffer.byteLength(serializeHazardInbox(base));base.retrievedAt='x'.repeat(budget);assert.equal(Buffer.byteLength(serializeHazardInbox(base)),256*1024);base.retrievedAt+='x';assert.throws(()=>serializeHazardInbox(base));
});
test("inbox SSR is explicit unqueried/manual and role-specific without notification claims",()=>{
 for(const role of ['manager','editor','viewer'] as const){const html=renderToStaticMarkup(createElement(HazardInboxPanel,{site:{id:'s',name:'합성',role,version:1},onOpen:()=>{}}));assert.match(html,/아직 조회하지 않았습니다/);assert.match(html,/현재 업무 새로고침/);assert.match(html,/알림 발송·읽음 확인·자동 처리 기능이 아닙니다/);assert.equal(html.includes('<option value="reviews">'),role==='manager');assert.doesNotMatch(html,/대기 0건|발송 완료/);}
});

test("actual hazard parent renders inbox beside existing list without bypassing detail workflow",()=>{
 const html=renderToStaticMarkup(createElement(HazardsPanel,{site:{id:'s',name:'합성',role:'manager',version:1},user:{id:'u',name:'합성',email:'synthetic@example.test'},onDirtyChange:()=>{},onBusyChange:()=>{}}));
 assert.match(html,/내 신고 조치 · 검토 대기/);assert.match(html,/신고 상태 필터/);assert.match(html,/미검사 다운로드 전용/);assert.doesNotMatch(html,/사진\/파일 첨부와 위험/);
});
