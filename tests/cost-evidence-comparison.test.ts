import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { costEvidenceFixture } from "./fixtures/cost-evidence-fixture.js";
import { boundedComparisonJson, compareEvidenceFacts } from "../server/cost-evidence-comparison.js";
import { comparisonSelection, renderEvidenceComparison } from "../server/cost-evidence-comparison-routes.js";
import { CostEvidenceComparison } from "../src/CostEvidenceComparison.js";
import type { CurrentCostEvidence } from "../server/cost-evidence-model.js";
import type { CostExpense } from "../server/cost-model.js";
import { journalHash } from "../server/daily-journal-sources.js";
test("comparison real app fixed/baseline current refs, stale, complete exports and readonly business bytes", async () => {
 const f=await costEvidenceFixture(); try {
  const e=await f.expense("PRIVATE FINANCIAL DESCRIPTION"); const up=await f.upload(); const file=up.body.items[0].file;
  assert.equal((await f.links(file.id,[{expenseId:e.id,version:e.version}])).status,200);
  const closed=(await f.close()).body, closureId=closed.current_close_id;
  const baseline=(await f.send(f.base+"/baselines",{version:closed.version,closureId,closureHash:closed.currentClosure.hash,memo:"PRIVATE BASELINE"})).body;
  const base=f.siteBase+f.base+"/evidence-comparison", q={closureId};
  let r=await f.agent.get(base+"/prepare").query(q); assert.equal(r.status,200,r.text);const initial=r.body.fingerprint;
  assert.equal(r.body.changes,undefined);assert.equal((await f.agent.get(base+"/prepare").query(q)).body.fingerprint,initial);
  assert.equal((await f.send(f.base+"/reopen",{version:closed.version,reason:"합성 재개"})).status,200);
  assert.equal((await f.agent.get(base+"/compare").query({...q,expectedFingerprint:initial})).status,409);
  assert.equal((await f.links(file.id,[])).status,200);assert.equal((await f.upload()).status,200);
  const tables=["audit","idempotency","cost_periods","cost_expenses","cost_closures","cost_baselines","cost_events","cost_close_evidence","cost_evidence_files","cost_evidence_links","cost_evidence_events"];
  const bytes=()=>JSON.stringify(tables.map(t=>f.db.prepare(`SELECT * FROM ${t}`).all()));const before=bytes();
  r=await f.agent.get(base+"/prepare").query(q);const query={...q,expectedFingerprint:r.body.fingerprint};
  r=await f.agent.get(base+"/compare").query(query);assert.equal(r.status,200,r.text);assert.equal(r.body.changes.addedOriginals.length,1);assert.equal(r.body.changes.removedReferences.length,1);assert.equal(r.body.changes.changedReferences.length,0);
  const json=await f.agent.get(base+"/export.json").query(query);assert.equal(json.status,200);assert.match(json.headers['content-disposition'],/attachment/);assert.equal(json.headers['cache-control'],'no-store');assert.doesNotMatch(json.text,/PRIVATE FINANCIAL|PRIVATE BASELINE|SYNTHETIC NOT/);assert.deepEqual(JSON.parse(json.text).changes,r.body.changes);
  const html=await f.agent.get(base+"/print").query(query);assert.equal(html.status,200);assert.match(html.text,/&lt;own&gt;/);assert.doesNotMatch(html.text,/<script|<img|PRIVATE FINANCIAL/);
  const bp=await f.agent.get(base+"/prepare").query({baselineId:baseline.id});assert.equal(bp.body.source.closureId,closureId);assert.equal(bp.body.source.baselineId,baseline.id);
  assert.equal(bytes(),before);
  assert.equal((await f.agent.get(base+"/prepare").query({closureId:randomUUID()})).status,404);
  assert.equal((await f.agent.get(base+"/prepare").query({closureId,baselineId:baseline.id})).status,400);
  f.db.prepare("UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?").run(f.site,f.manager);
  assert.equal((await f.agent.get(base+"/prepare").query(q)).status,403);
 } finally {f.db.close();}
});
test("explicit empty fixed list is comparable; old absent sidecar is not recorded, never zero",async()=>{
 const f=await costEvidenceFixture();try{
  const closed=(await f.close()).body,q={closureId:closed.current_close_id},base=f.siteBase+f.base+"/evidence-comparison";
  let r=await f.agent.get(base+"/prepare").query(q);assert.equal(r.body.state,'ready');
  r=await f.agent.get(base+"/compare").query({...q,expectedFingerprint:r.body.fingerprint});assert.deepEqual(r.body.changes,{addedOriginals:[],addedReferences:[],removedReferences:[],changedReferences:[]});
  // Synthetic historical fixture: absent sidecars predate Phase64. No product repair path.
  const triggers=f.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='cost_close_evidence'").all() as {name:string}[];
  for(const t of triggers)f.db.exec(`DROP TRIGGER "${t.name}"`);f.db.exec("DELETE FROM cost_close_evidence");
  r=await f.agent.get(base+"/prepare").query(q);assert.equal(r.body.state,'not_recorded');assert.equal(r.body.changes,null);assert.equal(r.body.fingerprint,null);
 }finally{f.db.close();}
});
function facts(count=1,shift=0){
 const expenses=Array.from({length:1000},(_,i)=>({id:`expense-${i}`,period_id:'period',version:1,status:'active',description:'private'} as CostExpense));
 const source:CurrentCostEvidence={period:{id:'period',siteId:'site',month:'2026-10',version:1,status:'open'},evidenceVersion:1,items:Array.from({length:count},(_,i)=>({file:{id:`file-${i}`,filename:'<own>.pdf',format:'application/pdf',size:10,sha256:'a'.repeat(64),uploaded_by:'person',uploaded_at:'time'},links:expenses.slice(shift+i*50,shift+i*50+50).map(e=>({expenseId:e.id,source:e,sourceHash:journalHash(e),currentVersion:e.version,currentStatus:e.status,changedSinceLink:false}))})),warnings:{activeExpensesWithoutLink:[],changedLinks:[],cancelledLinks:[],unlinkedFiles:[]}};
 return {source,expenses};
}
test("pure reference classifications and immutable file discrepancies fail rather than become changes",()=>{
 const {source,expenses}=facts();const now=structuredClone(source),rows=structuredClone(expenses);
 rows[0].version=2;now.items[0].links[0].currentVersion=2;now.items[0].links[0].changedSinceLink=true;
 let diff=compareEvidenceFacts(source,now,expenses,rows);assert.equal(diff.changedReferences[0].currentExpenseChanged,true);assert.equal(diff.changedReferences[0].sourceReselected,false);
 now.items[0].links[0].source=rows[0];now.items[0].links[0].sourceHash=journalHash(rows[0]);now.items[0].links[0].changedSinceLink=false;
 diff=compareEvidenceFacts(source,now,expenses,rows);assert.equal(diff.changedReferences[0].sourceReselected,true);
 now.items[0].file.sha256='b'.repeat(64);assert.throws(()=>compareEvidenceFacts(source,now,expenses,rows));
 now.items=[];assert.throws(()=>compareEvidenceFacts(source,now,expenses,rows));
});
test("full 2000 reference union, count caps and exact JSON/HTML byte bounds",()=>{
 const {source,expenses}=facts(20);const now=structuredClone(source);
 for(let i=0;i<20;i++)now.items[i].links=source.items[(i+1)%20].links;
 const d=compareEvidenceFacts(source,now,expenses,expenses);assert.equal(d.addedReferences.length,1000);assert.equal(d.removedReferences.length,1000);
 const tooMany=structuredClone(now);tooMany.items.push(tooMany.items[0]);assert.throws(()=>compareEvidenceFacts(source,tooMany,expenses,expenses));
 now.items[0].links.push(now.items[0].links[0]);assert.throws(()=>compareEvidenceFacts(source,now,expenses,expenses));
 assert.throws(()=>compareEvidenceFacts(source,source,[...expenses,expenses[0]],expenses));
 const max=4*1024*1024;assert.equal(Buffer.byteLength(boundedComparisonJson('a'.repeat(max-3))),max);assert.throws(()=>boundedComparisonJson('a'.repeat(max-2)));
 assert.throws(()=>renderEvidenceComparison({state:'unavailable',selection:{closureId:'x'},fingerprint:null,changes:null,queriedAt:'x',reason:'<'.repeat(max/4)}));
 assert.equal(comparisonSelection.safeParse({}).success,false);
});
test("comparison initial SSR distinguishes metadata from validation and offers explicit prepare",()=>{
 const html=renderToStaticMarkup(createElement(CostEvidenceComparison,{base:'/sites/s/cost-periods/p',selection:{closureId:'c'}}));
 assert.match(html,/비교 준비/);assert.match(html,/과거 미기록은 빈 목록과 다릅니다/);assert.match(html,/원본 바이트 재검사/);assert.doesNotMatch(html,/차이 없음|발송 완료/);
});
test("real cancellation restore and explicit source reselection remain distinct",async()=>{
 const f=await costEvidenceFixture();try{
  const e=await f.expense(),file=(await f.upload()).body.items[0].file;
  assert.equal((await f.links(file.id,[{expenseId:e.id,version:e.version}])).status,200);
  const closed=(await f.close()).body,base=f.siteBase+f.base+"/evidence-comparison",q={closureId:closed.current_close_id};
  assert.equal((await f.send(f.base+"/reopen",{version:closed.version,reason:"비교 합성 재개"})).status,200);
  async function compare(){const p=await f.agent.get(base+"/prepare").query(q);const r=await f.agent.get(base+"/compare").query({...q,expectedFingerprint:p.body.fingerprint});assert.equal(r.status,200,r.text);return r.body.changes.changedReferences[0];}
  let r=await f.send(f.base+`/expenses/${e.id}/cancel`,{version:(await f.current()).version,reason:"합성 취소"});assert.equal(r.status,200);
  let change=await compare();assert.equal(change.after.expense.status,'cancelled');assert.equal(change.sourceReselected,false);assert.equal(change.currentExpenseChanged,true);
  r=await f.send(f.base+`/expenses/${e.id}/restore`,{version:r.body.period.version,reason:"합성 복원"});assert.equal(r.status,200);
  assert.equal((await f.links(file.id,[{expenseId:e.id,version:r.body.expense.version}])).status,200);
  change=await compare();assert.equal(change.after.expense.status,'active');assert.equal(change.sourceReselected,true);assert.equal(change.currentExpenseChanged,true);
 }finally{f.db.close();}
});
test("stored same-ID metadata mismatch becomes unavailable null without repair",async()=>{
 const f=await costEvidenceFixture();try{
  await f.upload();const closed=(await f.close()).body;
  // Deliberately malformed synthetic fixture only, not a product mutation or repair API.
  const triggers=f.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='cost_evidence_files'").all() as {name:string}[];
  for(const t of triggers)f.db.exec(`DROP TRIGGER "${t.name}"`);
  f.db.exec("UPDATE cost_evidence_files SET filename='changed.pdf'");
  const before=JSON.stringify(f.db.prepare("SELECT * FROM cost_evidence_files").all());
  const r=await f.agent.get(f.siteBase+f.base+"/evidence-comparison/prepare").query({closureId:closed.current_close_id});
  assert.equal(r.status,200,r.text);assert.equal(r.body.state,'unavailable');assert.equal(r.body.changes,null);assert.equal(r.body.fingerprint,null);
  assert.equal(JSON.stringify(f.db.prepare("SELECT * FROM cost_evidence_files").all()),before);
 }finally{f.db.close();}
});
