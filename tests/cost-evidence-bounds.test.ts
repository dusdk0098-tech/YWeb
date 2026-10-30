import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { costEvidenceFixture, png } from "./fixtures/cost-evidence-fixture.js";
import { attachmentUsage } from "../server/attachment-quota.js";
test("cost evidence50links/20originals and combined four-domain200 retained files share the same reader",async()=>{
 const f=await costEvidenceFixture();try{
  const targets=[];for(let n=0;n<51;n++){const e=await f.expense(`합성 ${n}`);targets.push({expenseId:e.id,version:e.version});}
  let r=await f.upload(png,"own.png","image/png");assert.equal(r.status,200);const file=r.body.items[0].file;
  assert.equal((await f.links(file.id,targets.slice(0,50))).status,200);
  assert.equal((await f.links(file.id,targets)).status,400);
  assert.equal((await f.links(file.id,[])).status,200);
  for(let n=1;n<20;n++){r=await f.upload(png,`file${n}.png`,"image/png");assert.equal(r.status,200,r.text);}
  assert.equal((await f.upload(png,"21.png","image/png")).status,409);
  let hazard="",meeting="",plan="";const hash=createHash("sha256").update(png).digest("hex");
  for(let n=0;n<60;n++){
   if(n%20===0){ hazard=randomUUID();meeting=randomUUID();plan=randomUUID();
  f.db.prepare("INSERT INTO hazard_reports(id,site_id,owner_id,body,status,created_at,updated_at) VALUES(?,?,?,'{}','draft','now','now')").run(hazard,f.site,f.manager);
  f.db.prepare("INSERT INTO minutes VALUES(?,?,'{}',1,?,'now','now')").run(meeting,f.site,f.manager);
  f.db.prepare("INSERT INTO work_plans VALUES(?,?,'{}','draft',1,?,NULL,'',NULL,'now','now')").run(plan,f.site,f.manager);
   }
   f.db.prepare("INSERT INTO hazard_attachments VALUES(?,?,?,'h.png','image/png',?,?,?,0,?,'now')").run(randomUUID(),f.site,hazard,png.length,hash,png,f.manager);
   f.db.prepare("INSERT INTO minutes_attachments VALUES(?,?,?,'m.png','image/png',?,?,?,0,?,'now')").run(randomUUID(),f.site,meeting,png.length,hash,png,f.manager);
   f.db.prepare("INSERT INTO work_plan_attachments VALUES(?,?,?,'p.png','image/png',?,?,?,0,?,'now')").run(randomUUID(),f.site,plan,png.length,hash,png,f.manager);
  }
  const usage=attachmentUsage(f.db,f.site,(await f.current()).id,"cost");assert.equal(usage.reportCount,20);assert.equal(usage.siteCount,200);assert.equal(usage.siteBytes,200*png.length);assert.equal(usage.totalBytes,200*png.length);
  const closed=await f.close();assert.equal(closed.status,200,closed.text);
  const carried=await f.send(f.base+"/carry",{version:closed.body.version});assert.equal(carried.status,200);
  const upload=await f.agent.post(f.siteBase+`/cost-periods/${carried.body.id}/evidence/files`).set("Origin","http://127.0.0.1:3000").set("x-csrf-token",f.csrf).set("content-type","application/octet-stream").set("x-cost-period-version","1").set("x-cost-evidence-version","0").set("x-file-name","new.png").set("x-file-type","image/png").set("idempotency-key",randomUUID()).send(png);
  assert.equal(upload.status,409,upload.text);assert.equal(attachmentUsage(f.db,f.site,carried.body.id,"cost").reportCount,0);
  const source=readFileSync(new URL("../server/app.ts",import.meta.url),"utf8");assert.equal((source.match(/=boundedUploadReader\(\)/g)||[]).length,1);assert.match(source,/registerCostEvidence\(app,db,\{access,mutate\},attachmentReader\)/);
 }finally{f.db.close();}
});
