import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {methodFixture} from './fixtures/risk-method-fixture.js';
import {attachmentUsage} from '../server/attachment-quota.js';
import {isWorkPlanUpload} from '../server/work-plan-attachment-routes.js';
const body={title:'Synthetic attachment plan',date:'2026-10-28',startTime:'09:00',endTime:'10:00',location:'Synthetic',workDescription:'Synthetic',emergencyProcedure:'Synthetic',verificationNote:'Not a legal approval',steps:[{task:'Task',procedure:'Procedure',precaution:'Precaution'}],equipmentIds:[],duties:[]};
const pdf=Buffer.from('%PDF-1.7\nSynthetic header fixture, not valid PDF'),png=Buffer.from([137,80,78,71,13,10,26,10,0]);
async function fixture(){const f=await methodFixture(),csrf=(await f.agent.get('/api/session')).body.csrf,reviewCsrf=(await f.reviewAgent.get('/api/session')).body.csrf;
 const upload=(id:string,version:number,bytes=pdf,name='synthetic.pdf',format='application/pdf',key=randomUUID(),review=false)=> (review?f.reviewAgent:f.agent).post(f.base+`/work-plans/${id}/attachments`).set('Origin','http://127.0.0.1:3000').set('x-csrf-token',review?reviewCsrf:csrf).set('content-type','application/octet-stream').set('x-work-plan-version',String(version)).set('x-file-name',encodeURIComponent(name)).set('x-file-type',format).set('idempotency-key',key).send(bytes);
 const draft=async()=>{let r=await f.send('post','/work-plans',{body});assert.equal(r.status,200);r=await f.send('post',`/work-plans/${r.body.id}/capture`,{version:1});assert.equal(r.status,200);return r.body;};return {...f,upload,draft};}
test('plan author uploads fixed submitted manifest; review return starts empty without changing original',async()=>{
 const f=await fixture();try{
 f.db.prepare("UPDATE memberships SET role='editor' WHERE user_id=? AND site_id=?").run(f.manager,f.site);
 let p=await f.draft();const source=JSON.stringify(p.source_capture);assert.equal((await f.upload(p.id,p.version,Buffer.from('not PDF'))).status,400);assert.equal((await f.upload(p.id,p.version,pdf,'wrong.png')).status,400);const key=randomUUID();let r=await f.upload(p.id,p.version,pdf,'<source>.pdf','application/pdf',key);assert.equal(r.status,200,r.text);const first=r.body.attachments[0],originalVersion=p.version,receipt=r.body;p=r.body.record;
 assert.equal(JSON.stringify(p.source_capture),source);assert.deepEqual((await f.upload(p.id,originalVersion,pdf,'<source>.pdf','application/pdf',key)).body,receipt);
 assert.equal((await f.upload(p.id,p.version,pdf,'manager.pdf','application/pdf',randomUUID(),true)).status,403);
 r=await f.upload(p.id,p.version,png,'synthetic.png','image/png');assert.equal(r.status,200);p=r.body.record;const other=r.body.attachments.find((a:{id:string})=>a.id!==first.id);
 r=await f.send('post',`/work-plans/${p.id}/attachments/${other.id}/state`,{version:p.version,attached:false,reason:'Exclude but retain'});assert.equal(r.status,200);p=r.body.record;
 r=await f.send('post',`/work-plans/${p.id}/submit`,{version:p.version,reason:'Document only',confirmDocumentOnly:true});assert.equal(r.status,200,r.text);p=r.body;assert.equal(p.snapshot.body.attachmentManifest.schemaVersion,1);assert.deepEqual(p.snapshot.body.attachmentManifest.items.map((a:{id:string})=>a.id),[first.id]);
 const old=f.db.prepare('SELECT * FROM work_plan_snapshots WHERE plan_id=?').get(p.id),html=(await f.agent.get(f.base+`/work-plans/${p.id}/print`)).text;assert.ok(html.includes('&lt;source&gt;.pdf'));assert.ok(html.includes(first.sha256));assert.ok(!html.includes('synthetic.png'));assert.doesNotMatch(html,/<(?:img|iframe|object|embed)\b/);
 assert.equal((await f.upload(p.id,originalVersion,pdf,'<source>.pdf','application/pdf',key)).status,409);
 const rv=p.documentReview.review;r=await f.reviewSend(`/work-plans/${p.id}/review`,{version:rv.version,submissionHash:rv.submission_hash,decision:'returned',authorId:f.reviewer,reason:'Revise content',confirmDocumentOnly:true});assert.equal(r.status,200,r.text);const next=r.body.nextDraft;assert.equal(next.parent_id,p.id);assert.equal(next.source_capture,null);assert.deepEqual((await f.agent.get(f.base+`/work-plans/${next.id}/attachments`)).body,[]);
 assert.equal((await f.upload(next.id,next.version)).status,403);assert.equal((await f.upload(next.id,next.version,pdf,'new.pdf','application/pdf',randomUUID(),true)).status,200);
 assert.deepEqual(f.db.prepare('SELECT * FROM work_plan_snapshots WHERE plan_id=?').get(p.id),old);assert.equal((await f.agent.get(f.base+`/work-plans/${p.id}/print`)).text,html);
 f.db.prepare("UPDATE memberships SET role='viewer' WHERE user_id=? AND site_id=?").run(f.manager,f.site);
 const down=await f.agent.get(f.base+`/work-plans/${p.id}/attachments/${other.id}/download`);assert.equal(down.status,200);assert.deepEqual(down.body,png);assert.match(down.headers['content-type'],/^application\/octet-stream/);assert.match(down.headers['content-disposition'],/^attachment;/);assert.equal(down.headers['cache-control'],'no-store');assert.equal(down.headers['x-content-type-options'],'nosniff');assert.equal(down.headers['x-attachment-scan'],'UNSCANNED');
 assert.throws(()=>f.db.prepare('UPDATE work_plan_attachments SET attached=0 WHERE id=?').run(first.id),/immutable/);assert.throws(()=>f.db.exec('DELETE FROM work_plan_attachment_events'),/retained/);
 }finally{f.db.close();}
});
test('manager archive and revision preserve author-only attachment policy; rollback and exact version apply',async()=>{
 const f=await fixture();try{
 let p=await f.draft();const initial=f.db.prepare('SELECT * FROM work_plans WHERE id=?').get(p.id),events=f.db.prepare('SELECT * FROM work_plan_events WHERE plan_id=?').all(p.id);
 f.db.exec("CREATE TRIGGER fail_plan_attachment BEFORE INSERT ON work_plan_attachment_events BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");assert.equal((await f.upload(p.id,p.version)).status,500);assert.deepEqual(f.db.prepare('SELECT * FROM work_plans WHERE id=?').get(p.id),initial);assert.equal(f.db.prepare('SELECT count(*) n FROM work_plan_attachments').get()!.n,0);assert.deepEqual(f.db.prepare('SELECT * FROM work_plan_events WHERE plan_id=?').all(p.id),events);f.db.exec('DROP TRIGGER fail_plan_attachment');
 let r=await f.upload(p.id,p.version);assert.equal(r.status,200);const attachment=r.body.attachments[0];assert.equal((await f.upload(p.id,p.version)).status,409);p=r.body.record;
 const unchanged=f.db.prepare('SELECT * FROM work_plan_attachments WHERE id=?').get(attachment.id);r=await f.reviewSend(`/work-plans/${p.id}/archive`,{version:p.version});assert.equal(r.status,200,r.text);p=r.body;assert.equal(p.documentReview.kind,'unreviewed_archive');assert.equal(p.snapshot.body.attachmentManifest.items[0].id,attachment.id);
 assert.equal((await f.send('post',`/work-plans/${p.id}/attachments/${attachment.id}/state`,{version:p.version,attached:false,reason:'Forbidden after archive'})).status,409);
 r=await f.reviewSend(`/work-plans/${p.id}/revise`,{version:p.version,authorId:f.manager,reason:'New draft'});assert.equal(r.status,200);assert.deepEqual((await f.agent.get(f.base+`/work-plans/${r.body.id}/attachments`)).body,[]);assert.deepEqual(f.db.prepare('SELECT * FROM work_plan_attachments WHERE id=?').get(attachment.id),unchanged);
 // A separate submitted record can be accepted without rewriting the manifest.
 let q=await f.draft();r=await f.upload(q.id,q.version);q=r.body.record;r=await f.send('post',`/work-plans/${q.id}/submit`,{version:q.version,reason:'Submit',confirmDocumentOnly:true});assert.equal(r.status,200);q=r.body;const snap=f.db.prepare('SELECT * FROM work_plan_snapshots WHERE plan_id=?').get(q.id),rv=q.documentReview.review;
 r=await f.reviewSend(`/work-plans/${q.id}/review`,{version:rv.version,submissionHash:rv.submission_hash,decision:'accepted',reason:'Document review',confirmDocumentOnly:true});assert.equal(r.status,200);assert.deepEqual(f.db.prepare('SELECT * FROM work_plan_snapshots WHERE plan_id=?').get(q.id),snap);
 }finally{f.db.close();}
});
test('three original modules share quota; plan retained20 includes detached and whole list is bounded',async()=>{
 const f=await fixture();try{
 let p=await f.draft();let first='';
 for(let i=0;i<20;i++){const r=await f.upload(p.id,p.version,i%2?png:pdf,`synthetic-${i}.${i%2?'png':'pdf'}`,i%2?'image/png':'application/pdf');assert.equal(r.status,200);p=r.body.record;first ||= r.body.attachments[0].id;}
 const r=await f.send('post',`/work-plans/${p.id}/attachments/${first}/state`,{version:p.version,attached:false,reason:'Retain at capacity'});assert.equal(r.status,200);p=r.body.record;assert.equal((await f.upload(p.id,p.version)).status,409);assert.equal(attachmentUsage(f.db,f.site,p.id,'work_plan').reportCount,20);
 const report=randomUUID();f.db.prepare("INSERT INTO hazard_reports(id,site_id,owner_id,body,status,created_at,updated_at) VALUES(?,?,?,'{}','draft','now','now')").run(report,f.site,f.manager);f.db.prepare("INSERT INTO hazard_attachments VALUES(?,?,?,'a.png','image/png',?,'synthetic',?,0,?,'now')").run(randomUUID(),f.site,report,png.length,png,f.manager);
 const m=(await f.send('post','/minutes',{title:'Synthetic',type:'기타',date:'2026-10-28',time:'09:00',location:'S',attendees:'S',agenda:'S',discussion:'S',decisions:'S',actions:[]})).body;
 f.db.prepare("INSERT INTO minutes_attachments VALUES(?,?,?,'m.pdf','application/pdf',?,'synthetic',?,0,?,'now')").run(randomUUID(),f.site,m.id,pdf.length,pdf,f.manager);
 const usage=attachmentUsage(f.db,f.site,p.id,'work_plan');assert.equal(usage.siteCount,22);assert.equal(usage.totalBytes,11*(pdf.length+png.length));assert.equal(attachmentUsage(f.db,f.site,m.id,'minutes').reportCount,1);assert.equal(attachmentUsage(f.db,f.site,report).reportCount,1);
 let extraReport='';for(let i=0;i<178;i++){if(i%20===0){extraReport=randomUUID();f.db.prepare("INSERT INTO hazard_reports(id,site_id,owner_id,body,status,created_at,updated_at) VALUES(?,?,?,'{}','draft','now','now')").run(extraReport,f.site,f.manager);}f.db.prepare("INSERT INTO hazard_attachments VALUES(?,?,?,'a.png','image/png',?,'synthetic',?,0,?,'now')").run(randomUUID(),f.site,extraReport,png.length,png,f.manager);}
 const q=await f.draft();assert.equal(attachmentUsage(f.db,f.site,q.id,'work_plan').siteCount,200);assert.equal((await f.upload(q.id,q.version)).status,409);assert.equal(attachmentUsage(f.db,f.site,q.id,'work_plan').reportCount,0);
 const {readFile}=await import('node:fs/promises'),app=await readFile(new URL('../server/app.ts',import.meta.url),'utf8');assert.equal((app.match(/=\s*boundedUploadReader\(\)/g)||[]).length,1);for(const name of ['Hazard','Minutes','WorkPlan'])assert.match(app,new RegExp(`register${name}Attachments\\([^;]*attachmentReader\\)`));
 assert.equal(isWorkPlanUpload('POST','/API/SITES/s/WORK-PLANS/p/ATTACHMENTS/'),true);assert.equal(isWorkPlanUpload('POST','/api/sites/s/work-plans/p/attachments/x/state'),false);
 }finally{f.db.close();}
});
