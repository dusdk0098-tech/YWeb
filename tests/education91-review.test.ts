import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,rmSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { prepareEducation91Review } from '../scripts/prepare-education91-review.js';
import { previewEducationContent } from '../server/education-transfer-model.js';
import { costEvidenceFixture } from './fixtures/cost-evidence-fixture.js';
import { EducationContentTransfer } from '../src/EducationContentTransfer.js';
import { DailyInspectionReferences } from '../src/DailyInspectionReferences.js';
import { WorkPlanLiftingFields,blankLifting } from '../src/WorkPlanLiftingFields.js';
const markdown='# Synthetic review\n\n## 교육목표\n- Own synthetic objective\n\n## Content\nSynthetic <text>, not medical or legal advice.\n';
const source={itemNumber:91,title:'Synthetic research draft',language:'ko-KR',status:'research_draft_not_imported',retrievedAt:'2026-10-29T03:22:48Z',contentFormat:'markdown',content:markdown,note:'Synthetic source only'};
const prepare=()=>prepareEducation91Review(JSON.stringify(source),markdown);
test('91 review uses exact existing four-field contract, preserves source, fails whole on mismatch/size/unknown fields',()=>{
 const result=prepare(),p=previewEducationContent({text:result.text});assert.equal(p.rows.length,1);assert.equal(p.digest,result.report.outputSha256);assert.deepEqual(Object.keys(p.rows[0].body),['title','categoryLabel','objectives','contents']);
 assert.equal(p.rows[0].body.objectives,'- Own synthetic objective');assert.ok(p.rows[0].body.contents.includes(markdown));assert.match(p.rows[0].body.contents,/미게시 검토용/);assert.equal(result.report.dbImport,false);assert.equal(result.report.published,false);
 for(const altered of [{...source,itemNumber:90},{...source,status:'published'},{...source,id:'not-allowed'},{...source,content:markdown+'x'}])assert.throws(()=>prepareEducation91Review(JSON.stringify(altered),markdown));
 assert.throws(()=>prepareEducation91Review('\ufeff'+JSON.stringify(source),markdown));assert.throws(()=>prepareEducation91Review(JSON.stringify(source),'가'.repeat(50000)));
 const large=markdown+'x'.repeat(9900);assert.throws(()=>prepareEducation91Review(JSON.stringify({...source,content:large}),large));
 const noObjective='Synthetic only';assert.throws(()=>prepareEducation91Review(JSON.stringify({...source,content:noObjective}),noObjective));
});
test('91 synthetic preview is read only; explicit import remains unpublished with no education session',async()=>{
 const f=await costEvidenceFixture();try{const result=prepare(),path='/education-content-transfer';
 const before=f.db.prepare('SELECT count(*) n FROM education_catalog').get()!.n;
 const preview=await f.send(path+'/preview',{text:result.text});assert.equal(preview.status,200,preview.text);assert.equal(f.db.prepare('SELECT count(*) n FROM education_catalog').get()!.n,before);
 const r=await f.send(path+'/import',{text:result.text,previewDigest:preview.body.digest,selectedIndexes:[0],declareRights:true});assert.equal(r.status,200,r.text);
 const saved=f.db.prepare('SELECT * FROM education_catalog WHERE id=?').get(r.body.created[0].id)!;assert.equal(saved.status,'draft');assert.equal(saved.published_snapshot,null);assert.ok(JSON.parse(String(saved.body)).contents.includes(markdown));assert.equal(f.db.prepare('SELECT count(*) n FROM education_sessions').get()!.n,0);
 }finally{f.db.close();}
});
test('91 local CLI refuses output overwrite and invalid UTF8 without database access',()=>{
 const dir=mkdtempSync(join(tmpdir(),'review91-'));try{const json=join(dir,'source.json'),md=join(dir,'source.md'),out=join(dir,'out');writeFileSync(json,JSON.stringify(source));writeFileSync(md,markdown);
 const run=()=>spawnSync(process.execPath,['--import','tsx','scripts/prepare-education91-review.ts',json,md,out],{encoding:'utf8'});
 assert.equal(run().status,0);const original=readFileSync(join(out,'education91-review-v1.json'));assert.notEqual(run().status,0);assert.deepEqual(readFileSync(join(out,'education91-review-v1.json')),original);
 writeFileSync(json,Buffer.from([0xff]));assert.notEqual(run().status,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('finalization SSR distinguishes separate review and unresolved engineering; empty date has no next-page action',()=>{
 const transfer=renderToStaticMarkup(createElement(EducationContentTransfer,{siteId:'s',onClose:()=>{},onDraft:()=>{},onDirtyChange:()=>{},onBusyChange:()=>{}}));assert.match(transfer,/그 원자료에는 코드91이 없습니다/);assert.match(transfer,/별도 조사 교육91/);
 const props={siteId:'s',date:'2026-10-29',value:[],onChange:()=>{},onBusy:()=>{}};
 assert.notEqual(DailyInspectionReferences(props).key,DailyInspectionReferences({...props,date:'2026-10-30'}).key);assert.notEqual(DailyInspectionReferences(props).key,DailyInspectionReferences({...props,siteId:'other'}).key);
 const daily=renderToStaticMarkup(createElement(DailyInspectionReferences,{siteId:'s',date:'',value:[],onChange:()=>{},onBusy:()=>{}}));assert.match(daily,/<button type="button" disabled="">다음50개/);
 const lifting=renderToStaticMarkup(createElement(WorkPlanLiftingFields,{siteId:'s',value:blankLifting(),equipmentIds:[],onChange:()=>{},onBusy:()=>{}}));assert.match(lifting,/공학 근거 미확정/);assert.match(lifting,/작업 허가를 판단하지 마세요/);
});
