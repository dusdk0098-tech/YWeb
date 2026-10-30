import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EducationContentTransfer } from "../src/EducationContentTransfer.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { costEvidenceFixture } from './fixtures/cost-evidence-fixture.js';
const env={...process.env,PYTHONDONTWRITEBYTECODE:'1'};
test('synthetic OOXML converter strict archive/XML/identity/code/full text contracts',()=>{
 const out=execFileSync('python',['tests/fixtures/education-converter-check.py'],{env,encoding:'utf8',stdio:'pipe'});assert.equal(out,'');
});
test('private converter CLI to existing preview/select/import creates all 50 new unpublished drafts only',async()=>{
 const tmp=mkdtempSync(join(tmpdir(),'pedit-edu-convert-')),f=await costEvidenceFixture();try{
  const source=join(tmp,'synthetic-2023.09.27.zip'),out=join(tmp,'private');
  const sha=execFileSync('python',['tests/fixtures/education-converter-check.py','fixture',source],{env,encoding:'utf8'}).trim();
  const args=['scripts/convert-education-source.py','--source',source,'--expected-sha256',sha,'--filename-revision','2023.09.27','--internal-revision','2025.05.30','--output-dir',out];
  const result=JSON.parse(execFileSync('python',args,{env,encoding:'utf8'}));assert.equal(result.count,50);assert.deepEqual(result.substitutedTitles,['9','10','31']);assert.deepEqual(readdirSync(out).sort(),['conversion-report.json','education-content-01.json','education-content-02.json','education-content-03.json']);
  assert.notEqual(spawnSync('python',args,{env}).status,0,'no overwrite');
  const report=JSON.parse(readFileSync(join(out,'conversion-report.json'),'utf8'));assert.equal(new Set(report.rows.map((r:{code:string})=>r.code)).size,50);
  let total=0;
  for(const file of result.files){
   const text=readFileSync(join(out,file.name),'utf8');const parsed=JSON.parse(text);assert.ok(parsed.records.length<=20);assert.ok(Buffer.byteLength(text)<=120*1024);
   const before=f.db.prepare('SELECT count(*) n FROM education_catalog').get() as {n:number};
   const preview=await f.send('/education-content-transfer/preview',{text});assert.equal(preview.status,200,preview.text);
   assert.equal((f.db.prepare('SELECT count(*) n FROM education_catalog').get() as {n:number}).n,before.n);
   const command={text,previewDigest:preview.body.digest,selectedIndexes:parsed.records.map((_:unknown,i:number)=>i),declareRights:true},key=randomUUID();
   const stale=await f.send('/education-content-transfer/import',{...command,text:text+' '});assert.equal(stale.status,409);
   const imported=await f.send('/education-content-transfer/import',command,key);assert.equal(imported.status,200,imported.text);total+=imported.body.created.length;
   assert.deepEqual((await f.send('/education-content-transfer/import',command,key)).body,imported.body);
   for(const row of imported.body.created){const saved=f.db.prepare('SELECT * FROM education_catalog WHERE id=?').get(row.id) as {status:string;version:number;body:string;parent_id:null};assert.equal(saved.status,'draft');assert.equal(saved.version,1);assert.equal(saved.parent_id,null);const body=JSON.parse(saved.body);assert.equal(body.contents,parsed.records[row.index].contents.trim());assert.equal(body.objectives,'');}
  }
  assert.equal(total,50);assert.equal((f.db.prepare('SELECT count(*) n FROM education_sessions').get() as {n:number}).n,0);
  f.db.prepare("UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?").run(f.site,f.manager);
  assert.equal((await f.send('/education-content-transfer/preview',{text:readFileSync(join(out,result.files[0].name),'utf8')})).status,403);
 }finally{f.db.close();rmSync(tmp,{recursive:true,force:true});}
});

test('source transfer notice clearly exposes missing code, revision mismatch, title mapping and unpublished selection',()=>{
 const html=renderToStaticMarkup(createElement(EducationContentTransfer,{siteId:'site',onClose:()=>{},onDraft:()=>{},onDirtyChange:()=>{},onBusyChange:()=>{}}));
 for(const text of ['그 원자료에는 코드91이 없습니다','내부 개정일이 다르고','긴 원제목','빈 교육목표','새 미게시 초안','120KiB'])assert.ok(html.includes(text));
 assert.ok(!html.includes('자동 게시'));
});
