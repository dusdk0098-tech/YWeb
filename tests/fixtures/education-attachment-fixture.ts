import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { costEvidenceFixture, pdf } from "./cost-evidence-fixture.js";
export const educationDetails={title:'합성 교육',courseLabel:'자체 분류',instructor:'직접 표시',date:'2026-10-28',startTime:'09:00',endTime:'10:00',breakMinutes:0,location:'합성 장소',objectives:'자체 목적',contents:'자체 내용'};
export async function educationAttachmentFixture(){
 const f=await costEvidenceFixture();const r=await f.send('/education',educationDetails);assert.equal(r.status,200,r.text);const id=r.body.id,url=`/education/${id}`;
 const current=async()=>{const r=await f.agent.get(f.siteBase+url);assert.equal(r.status,200,r.text);return r.body;};
 const upload=async(bytes=pdf,name='own.pdf',format='application/pdf',key:string=randomUUID(),version?:number)=>{const v=version??(await current()).version;return f.agent.post(f.siteBase+url+'/attachments').set('Origin','http://127.0.0.1:3000').set('x-csrf-token',f.csrf).set('content-type','application/octet-stream').set('x-education-version',String(v)).set('x-file-name',encodeURIComponent(name)).set('x-file-type',format).set('idempotency-key',key).send(bytes);};
 const ready=async()=>{let r=await f.send('/workers',{name:'합성 참여자',affiliation:'합성',kind:'worker'});assert.equal(r.status,200,r.text);const worker=r.body.id;r=await f.send(url+'/participants',{version:(await current()).version,workerId:worker});assert.equal(r.status,200,r.text);r=await f.send(url+'/participants/'+worker,{version:r.body.version,state:'attended',attendedMinutes:60},randomUUID(),'put');assert.equal(r.status,200,r.text);return r.body;};
 return {...f,id,url,current,upload,ready};
}
