import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../../server/db.js";
import { createApp } from "../../server/app.js";
export const pdf=Buffer.from("%PDF-1.7\nSYNTHETIC NOT A VALID PDF BODY"); export const png=Buffer.from([137,80,78,71,13,10,26,10,0]); const origin="http://127.0.0.1:3000";
export async function costEvidenceFixture(){
 const db=openDatabase(":memory:"),site=randomUUID(),manager=randomUUID(),password=randomUUID();
 db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(manager,"evidence@example.test","합성 관리자",await argon2.hash(password));db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site,"합성 현장");db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site,manager,"manager");
 const app=await createApp(db,{origin,secret:"synthetic-evidence".repeat(4)}),agent=request.agent(app);let r=await agent.get("/api/session");r=await agent.post("/api/login").set("Origin",origin).set("x-csrf-token",r.body.csrf).send({email:"evidence@example.test",password});assert.equal(r.status,200);const csrf=r.body.csrf,siteBase=`/api/sites/${site}`;
 const send=(path:string,body:object,key:string=randomUUID(),method:"post"|"put"="post")=>agent[method](siteBase+path).set("Origin",origin).set("x-csrf-token",csrf).set("idempotency-key",key).send(body);
 r=await send("/cost-periods",{month:"2026-10",openingNote:"합성",categories:[{label:"자체 비용",plan:"10000",opening:"0"}]});assert.equal(r.status,200);const period=r.body,base=`/cost-periods/${period.id}`;
 async function current(){const r=await agent.get(siteBase+base);assert.equal(r.status,200,r.text);return r.body;}
 async function context(){const r=await agent.get(siteBase+base+"/evidence");assert.equal(r.status,200,r.text);return r.body;}
 async function expense(description="합성 지출",quantity="2"){const p=await current();const r=await send(base+"/expenses",{version:p.version,expense:{categoryId:p.categories[0].id,spendDate:"2026-10-01",description,quantity,unitPriceWon:"1"}});assert.equal(r.status,200,r.text);return r.body.expense;}
 async function upload(bytes=pdf,filename="<own>.pdf",format="application/pdf",key:string=randomUUID()){
  const p=await current(),c=await context();return agent.post(siteBase+base+"/evidence/files").set("Origin",origin).set("x-csrf-token",csrf).set("content-type","application/octet-stream").set("x-cost-period-version",String(p.version)).set("x-cost-evidence-version",String(c.evidenceVersion)).set("x-file-name",encodeURIComponent(filename)).set("x-file-type",format).set("idempotency-key",key).send(bytes);
 }
 async function links(fileId:string,targets:{expenseId:string;version:number}[],key:string=randomUUID()){
  const c=await context();return send(base+`/evidence/files/${fileId}/links`,{periodVersion:c.period.version,evidenceVersion:c.evidenceVersion,targets,reason:"사용자 지정 참조",confirmReferencesOnly:true},key);
 }
 async function close(){const p=await current(),c=await context();return send(base+"/close",{version:p.version,reason:"합성 마감",...(c.evidenceVersion?{evidenceReview:{version:c.evidenceVersion,confirmUnverified:true}}:{})});}
 return {db,site,manager,agent,siteBase,base,send,current,context,expense,upload,links,close,csrf};
}
