import { costEvidenceFixture, pdf, png } from "./fixtures/cost-evidence-fixture.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { costReason } from "../server/cost-validation.js";
import { evidenceLinkInput } from "../server/cost-evidence-routes.js";
import { costEvidenceReview, COST_EVIDENCE_MANIFEST_BYTES, serializeCostEvidence } from "../server/cost-evidence-model.js";
import { attachmentUsage } from "../server/attachment-quota.js";
import { tooLargeStatus } from "./fixtures/too-large.js";
test("cost evidence no-evidence request bytes and bounded reference-only inputs",()=>{
 const old={version:3,reason:"same"};assert.equal(JSON.stringify(costReason.parse(old)),JSON.stringify(costReason.extend({evidenceReview:costEvidenceReview.optional()}).parse(old)));
 assert.throws(()=>evidenceLinkInput.parse({periodVersion:1,evidenceVersion:0,targets:Array.from({length:51},()=>({expenseId:randomUUID(),version:1})),reason:"x",confirmReferencesOnly:true}));
 const wrapper=JSON.stringify({text:""}).length;assert.equal(Buffer.byteLength(serializeCostEvidence({text:"x".repeat(COST_EVIDENCE_MANIFEST_BYTES-wrapper)})),COST_EVIDENCE_MANIFEST_BYTES);
 assert.throws(()=>serializeCostEvidence({text:"x".repeat(COST_EVIDENCE_MANIFEST_BYTES-wrapper+1)}),/분리|좁힌/);
});
test("real cost raw upload links close sidecar reopen detach and no-copy next month preserve finance",async()=>{
 const f=await costEvidenceFixture();try{
  const a=await f.expense("<지출1>"),b=await f.expense("지출2"),financial=Object.fromEntries(["cost_periods","cost_expenses","cost_events"].map(t=>[t,f.db.prepare(`SELECT * FROM ${t}`).all()]));
  let r=await f.upload();assert.equal(r.status,200,r.text);const file=r.body.items[0].file;assert.equal(r.body.items[0].links.length,0);
  r=await f.links(file.id,[{expenseId:a.id,version:a.version},{expenseId:b.id,version:b.version}]);assert.equal(r.status,200,r.text);assert.equal(r.body.items[0].links.length,2);
  for(const t of Object.keys(financial))assert.deepEqual(f.db.prepare(`SELECT * FROM ${t}`).all(),financial[t]);
  const p=await f.current();assert.equal((await f.send(f.base+"/close",{version:p.version,reason:"legacy no review"})).status,409);
  r=await f.close();assert.equal(r.status,200,r.text);let closed=r.body;const closureId=closed.current_close_id;
  const closure=f.db.prepare("SELECT * FROM cost_closures WHERE id=?").get(closureId),html=(await f.agent.get(f.siteBase+f.base+`/closures/${closureId}/print`)).text;
  r=await f.agent.get(f.siteBase+f.base+`/evidence/closures/${closureId}`);assert.equal(r.status,200,r.text);const fixed=r.body;assert.equal(fixed.recorded,true);assert.equal(fixed.snapshot.evidence.items[0].links.length,2);assert.equal(fixed.closureHash,closed.currentClosure.hash);
  const proof=(await f.agent.get(f.siteBase+f.base+`/evidence/closures/${closureId}/print`)).text;assert.match(proof,/&lt;own&gt;.pdf/);assert.doesNotMatch(proof,/<(?:img|iframe|object|embed)\b/);
  const download=await f.agent.get(f.siteBase+f.base+`/evidence/files/${file.id}/download`);assert.equal(download.status,200);assert.deepEqual(download.body,pdf);assert.equal(download.headers['x-attachment-scan'],'UNSCANNED');assert.equal(download.headers['cache-control'],'no-store');assert.equal(download.headers['x-content-type-options'],'nosniff');assert.match(download.headers['content-disposition'],/^attachment;/);
  assert.equal((await f.upload()).status,409);
  r=await f.send(f.base+"/baselines",{version:closed.version,closureId,closureHash:closed.currentClosure.hash,memo:"합성 금융 기준본"});assert.equal(r.status,200,r.text);const baseline=f.db.prepare("SELECT * FROM cost_baselines WHERE id=?").get(r.body.id);
  r=await f.send(f.base+"/reopen",{version:closed.version,reason:"명시 재개"});assert.equal(r.status,200,r.text);
  r=await f.links(file.id,[]);assert.equal(r.status,200);assert.equal(r.body.items[0].links.length,0);assert.equal(attachmentUsage(f.db,f.site,closed.id,"cost").reportCount,1);
  r=await f.close();assert.equal(r.status,200);closed=r.body;assert.notEqual(closed.current_close_id,closureId);
  assert.deepEqual((await f.agent.get(f.siteBase+f.base+`/evidence/closures/${closureId}`)).body,fixed);
  assert.deepEqual(f.db.prepare("SELECT * FROM cost_closures WHERE id=?").get(closureId),closure);assert.deepEqual(f.db.prepare("SELECT * FROM cost_baselines WHERE id=?").get(String(baseline!.id)),baseline);
  assert.equal((await f.agent.get(f.siteBase+f.base+`/closures/${closureId}/print`)).text,html);
  r=await f.send(f.base+"/carry",{version:closed.version});assert.equal(r.status,200);const next=r.body;
  assert.equal((await f.agent.get(f.siteBase+`/cost-periods/${next.id}/evidence`)).body.items.length,0);
  assert.equal((await f.agent.get(f.siteBase+`/cost-periods/${next.id}/evidence/files/${file.id}/download`)).status,404);
  assert.throws(()=>f.db.exec("DELETE FROM cost_evidence_files"));assert.throws(()=>f.db.exec("UPDATE cost_close_evidence SET hash='x'"));
 }finally{f.db.close();}
});
test("linked cost edit cancel restore split and undo never allocate or copy evidence",async()=>{
 const f=await costEvidenceFixture();try{
  let expense=await f.expense();let r=await f.upload(png,"own.png","image/png");assert.equal(r.status,200);const file=r.body.items[0].file;
  assert.equal((await f.links(file.id,[{expenseId:expense.id,version:expense.version}])).status,200);
  r=await f.send(f.base+`/expenses/${expense.id}/cancel`,{version:(await f.current()).version,reason:"합성 취소"});assert.equal(r.status,200);
  assert.equal((await f.context()).warnings.cancelledLinks.length,1);
  r=await f.send(f.base+`/expenses/${expense.id}/restore`,{version:r.body.period.version,reason:"합성 복원"});assert.equal(r.status,200);expense=r.body.expense;
  assert.equal((await f.context()).warnings.changedLinks.length,1);
  r=await f.send(f.base+`/expenses/${expense.id}/split`,{version:(await f.current()).version,reason:"합성 분할",children:[{description:"자식1",quantity:"1",unitPriceWon:"1"},{description:"자식2",quantity:"1",unitPriceWon:"1"}]});
  assert.equal(r.status,200,r.text);
  const splits=f.db.prepare("SELECT id FROM cost_splits WHERE source_expense_id=?").get(expense.id)!;
  const ctx=await f.context();assert.equal(ctx.items[0].links.length,1);assert.equal(ctx.items[0].links[0].expenseId,expense.id);assert.equal(ctx.warnings.activeExpensesWithoutLink.length,2);
  r=await f.send(f.base+`/splits/${splits.id}/undo`,{version:(await f.current()).version,reason:"합성 되돌림"});assert.equal(r.status,200,r.text);
  assert.equal((await f.context()).warnings.changedLinks.length,1);
  expense=(await f.agent.get(f.siteBase+f.base+`/expenses/${expense.id}`)).body;
  assert.equal((await f.links(file.id,[{expenseId:expense.id,version:expense.version}])).status,200);
  assert.equal((await f.context()).warnings.changedLinks.length,0);
 }finally{f.db.close();}
});
test("cost evidence ordinary stale commands header/role limits and atomic failure leave originals",async()=>{
 const f=await costEvidenceFixture();try{
  const expense=await f.expense();assert.equal((await f.upload(Buffer.from("not-pdf"))).status,400);assert.equal((await tooLargeStatus(f.upload(Buffer.alloc(5*1024*1024+1)))),413);
  assert.equal((await f.upload(pdf,"wrong.png","application/pdf")).status,400);
  f.db.exec("CREATE TRIGGER synthetic_evidence_fail BEFORE INSERT ON cost_evidence_events BEGIN SELECT RAISE(ABORT,'synthetic'); END;");assert.equal((await f.upload()).status,500);assert.equal(f.db.prepare("SELECT count(*) n FROM cost_evidence_files").get()!.n,0);f.db.exec("DROP TRIGGER synthetic_evidence_fail");
  let r=await f.upload();assert.equal(r.status,200);const file=r.body.items[0].file;
  assert.equal((await f.links(file.id,[{expenseId:expense.id,version:99}])).status,409);
  r=await f.links(file.id,[{expenseId:expense.id,version:1},{expenseId:expense.id,version:1}]);assert.equal(r.status,400);
  const p=await f.current();f.db.exec("CREATE TRIGGER synthetic_sidecar_fail BEFORE INSERT ON cost_close_evidence BEGIN SELECT RAISE(ABORT,'synthetic'); END;");assert.equal((await f.close()).status,500);assert.equal((await f.current()).version,p.version);assert.equal(f.db.prepare("SELECT count(*) n FROM cost_closures").get()!.n,0);f.db.exec("DROP TRIGGER synthetic_sidecar_fail");
  f.db.prepare("UPDATE memberships SET role='editor' WHERE site_id=? AND user_id=?").run(f.site,f.manager);
  assert.equal((await f.agent.get(f.siteBase+f.base+`/evidence/files/${file.id}/download`)).status,403);
  assert.equal((await f.agent.get(f.siteBase+f.base+"/evidence")).status,403);
 }finally{f.db.close();}
});
test("cost evidence repeat upload keeps original receipt; proof-only changes stale the close review",async()=>{
 const f=await costEvidenceFixture();try{
  const p=await f.current(),key=randomUUID();
  const upload=()=>f.agent.post(f.siteBase+f.base+"/evidence/files").set("Origin","http://127.0.0.1:3000").set("x-csrf-token",f.csrf).set("content-type","application/octet-stream").set("x-cost-period-version",String(p.version)).set("x-cost-evidence-version","0").set("x-file-name","same.png").set("x-file-type","image/png").set("idempotency-key",key).send(png);
  const first=await upload();assert.equal(first.status,200);const repeated=await upload();assert.equal(repeated.status,200);assert.equal(repeated.text,first.text);assert.equal(f.db.prepare("SELECT count(*) n FROM cost_evidence_files").get()!.n,1);
  const file=first.body.items[0].file;assert.equal((await f.links(file.id,[])).status,200);
  const bad=await f.send(f.base+"/close",{version:p.version,reason:"stale proof view",evidenceReview:{version:1,confirmUnverified:true}});assert.equal(bad.status,409);assert.equal(f.db.prepare("SELECT count(*) n FROM cost_closures").get()!.n,0);
  assert.equal((await f.close()).status,200);assert.equal((await upload()).status,409);
 }finally{f.db.close();}
});
