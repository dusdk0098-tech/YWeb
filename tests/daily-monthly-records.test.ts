import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import argon2 from "argon2";
import { journalHash } from "../server/daily-journal-sources.js";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { readDailyRegister, dailyRegisterQuery } from "../server/daily-journal-register.js";
const origin="http://127.0.0.1:3000";
test("monthly fixed API preserves missing/draft state, exact version, immutable print and later distinct record",async()=>{
 const db=openDatabase(":memory:");
 try {
  const manager=randomUUID(),viewer=randomUUID(),site=randomUUID(),foreign=randomUUID(),password="synthetic-only-password";
  const hash=await argon2.hash(password);
  for(const [id,name] of [[manager,"Historical manager"],[viewer,"Reader"]])db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(id,id+"@example.test",name,hash);
  for(const id of [site,foreign])db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(id,"Historical site <script>");
  db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site,manager,"manager");db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site,viewer,"viewer");
  const app=await createApp(db,{origin,secret:"synthetic-monthly-secret-".repeat(3)});
  async function login(id:string){const agent=request.agent(app);let r=await agent.get("/api/session");r=await agent.post("/api/login").set("Origin",origin).set("x-csrf-token",r.body.csrf).send({email:id+"@example.test",password});assert.equal(r.status,200);return {agent,csrf:r.body.csrf as string};}
  const m=await login(manager),v=await login(viewer),base=`/api/sites/${site}`,month="2026-10";
  const post=(path:string,body:object,key=randomUUID())=>m.agent.post(path).set("Origin",origin).set("x-csrf-token",m.csrf).set("idempotency-key",key).send(body);
  let preview=await m.agent.get(`${base}/daily-journal-months?month=${month}`);assert.equal(preview.status,200);assert.equal(preview.body.counts.noJournalDays,31);
  const command={month,expectedFingerprint:preview.body.fingerprint,expectedLatestId:null,reason:"Incomplete view retained",acknowledgeIncomplete:true},key=randomUUID();
  let r=await post(`${base}/daily-monthly-records`,command,key);assert.equal(r.status,200);const first=r.body;
  assert.equal((await post(`${base}/daily-monthly-records`,command,key)).body.body.id,first.body.id);
  assert.equal(first.body.report.counts.noJournalDays,31);
  const printed=await v.agent.get(`${base}/daily-monthly-records/${first.body.id}/print`);assert.equal(printed.status,200);assert.ok(printed.text.includes("&lt;script&gt;"));
  assert.equal((await v.agent.post(`${base}/daily-monthly-records`).set("Origin",origin).set("x-csrf-token",v.csrf).set("idempotency-key",randomUUID()).send(command)).status,403);
  assert.equal((await m.agent.get(`/api/sites/${foreign}/daily-monthly-records/${first.body.id}`)).status,403);
  assert.equal((await post(`${base}/daily-monthly-records`,{...command,expectedLatestId:first.body.id})).status,409);
  const daily={date:"2026-10-03",body:{workSummary:"Literal %_ 작업",workLocations:"North",safetyInstructions:"Manual safety note",observations:"observation needle",followupNotes:"",patrols:[]}};
  r=await post(`${base}/daily-journals`,daily);assert.equal(r.status,200);
  const dailyId=r.body.id;
  assert.equal((await post(`${base}/daily-monthly-records`,{...command,expectedLatestId:first.body.id})).status,409);
  let comparison=await m.agent.get(`${base}/daily-monthly-records/${first.body.id}/compare`);assert.equal(comparison.body.status,"changed");
  preview=await m.agent.get(`${base}/daily-journal-months?month=${month}`);
  r=await post(`${base}/daily-monthly-records`,{...command,expectedLatestId:first.body.id,expectedFingerprint:preview.body.fingerprint,reason:"Draft now present"});assert.equal(r.status,200);const second=r.body;
  assert.equal(second.body.number,2);assert.equal(second.body.parentHash,first.hash);assert.equal(second.body.report.counts.unarchivedRootDays,1);
  assert.equal(second.body.report.days[2].pendingDraft.id,dailyId);
  db.prepare("UPDATE sites SET name=? WHERE id=?").run("Renamed site",site);db.prepare("UPDATE users SET name=? WHERE id=?").run("Renamed manager",manager);
  assert.equal((await v.agent.get(`${base}/daily-monthly-records/${first.body.id}/print`)).text,printed.text);
  assert.throws(()=>db.prepare("UPDATE daily_monthly_records SET body='{}' WHERE id=?").run(first.body.id),/immutable/);
  assert.throws(()=>db.prepare("DELETE FROM daily_monthly_records WHERE id=?").run(first.body.id),/retained/);
  const search=await v.agent.get(`${base}/daily-journal-register?q=%25_&status=draft`);assert.equal(search.status,200);assert.equal(search.body.total,1);assert.equal(search.body.items[0].id,dailyId);
  assert.equal((await v.agent.get(`${base}/daily-journal-register?q=needle`)).body.total,1);
  assert.equal((await v.agent.get(`${base}/daily-journal-register?title=imagined`)).status,400);
  r=await post(`${base}/daily-journals/${dailyId}/capture`,{version:1});assert.equal(r.status,200);
  r=await post(`${base}/daily-journals/${dailyId}/archive`,{version:r.body.version});assert.equal(r.status,200);const originalDaily=r.body;
  async function saveNext(previousId:string,reason:string) {
    const current=await m.agent.get(`${base}/daily-journal-months?month=${month}`);
    const result=await post(`${base}/daily-monthly-records`,{...command,expectedLatestId:previousId,expectedFingerprint:current.body.fingerprint,reason});
    assert.equal(result.status,200);return result.body;
  }
  const third=await saveNext(second.body.id,"First archived day");
  assert.equal(third.body.report.days[2].archived.journalId,dailyId);
  assert.equal(third.body.report.days[2].archived.hash,originalDaily.snapshot.hash);
  const thirdPrint=(await m.agent.get(`${base}/daily-monthly-records/${third.body.id}/print`)).text;
  r=await post(`${base}/daily-journals/${dailyId}/revise`,{version:originalDaily.version,authorId:manager,reason:"Later correction"});assert.equal(r.status,200);const correction=r.body;
  const fourth=await saveNext(third.body.id,"Pending correction retained");
  assert.equal(fourth.body.report.days[2].archived.journalId,dailyId);
  assert.equal(fourth.body.report.days[2].pendingDraft.id,correction.id);
  assert.equal(fourth.body.report.counts.pendingCorrectionDays,1);
  r=await post(`${base}/daily-journals/${correction.id}/capture`,{version:1});assert.equal(r.status,200);
  r=await post(`${base}/daily-journals/${correction.id}/archive`,{version:r.body.version});assert.equal(r.status,200);
  const fifth=await saveNext(fourth.body.id,"Correction archived separately");
  assert.equal(fifth.body.report.days[2].archived.journalId,correction.id);
  assert.equal(fifth.body.report.days[2].pendingDraft,null);
  assert.equal((await m.agent.get(`${base}/daily-monthly-records/${third.body.id}/print`)).text,thirdPrint);
  assert.equal((await m.agent.get(`${base}/daily-journals/${dailyId}`)).body.snapshot.hash,originalDaily.snapshot.hash);
  db.prepare("UPDATE sites SET name=? WHERE id=?").run("After fifth",site);
  preview=await m.agent.get(`${base}/daily-journal-months?month=${month}`);
  const rollbackCommand={...command,expectedLatestId:fifth.body.id,expectedFingerprint:preview.body.fingerprint,reason:"Expected rollback"};
  db.exec("CREATE TRIGGER synthetic_monthly_audit_failure BEFORE INSERT ON audit WHEN NEW.event='daily.monthly-record' BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END;");
  assert.equal((await post(`${base}/daily-monthly-records`,rollbackCommand)).status,500);
  assert.equal(db.prepare("SELECT count(*) n FROM daily_monthly_records").get()?.n,5);
  db.exec("DROP TRIGGER synthetic_monthly_audit_failure");
  let prior=fifth;
  db.exec("BEGIN");
  for(let number=6;number<=1000;number++) {
    const body={...fifth.body,id:randomUUID(),number,parentId:prior.body.id,parentHash:prior.hash};const hash=journalHash(body);
    db.prepare("INSERT INTO daily_monthly_records VALUES(?,?,?,?,?,?,?,?)").run(body.id,site,month,number,body.parentId,JSON.stringify(body),hash,body.recordedAt);prior={body,hash};
  }
  db.exec("COMMIT");
  const firstPage=await m.agent.get(`${base}/daily-monthly-records?month=${month}`);assert.equal(firstPage.body.items.length,50);assert.equal(firstPage.body.hasMore,true);assert.equal(firstPage.body.latest.number,1000);
  const lastPage=await m.agent.get(`${base}/daily-monthly-records?month=${month}&offset=950`);assert.equal(lastPage.body.items.length,50);assert.equal(lastPage.body.hasMore,false);
  const capped=await post(`${base}/daily-monthly-records`,{...rollbackCommand,expectedLatestId:prior.body.id});assert.equal(capped.status,409);assert.match(capped.body.error,/1,000/);
  assert.equal(db.prepare("SELECT count(*) n FROM daily_monthly_records").get()?.n,1000);
  // Simulate an unavailable source relation without bypassing foreign-key constraints.
  db.exec("ALTER TABLE daily_journals RENAME TO synthetic_unavailable_daily_journals");
  comparison=await m.agent.get(`${base}/daily-monthly-records/${second.body.id}/compare`);assert.equal(comparison.body.status,"unavailable");
 } finally {db.close();}
});
test("daily literal search validates range and paginates actual versions at 50/51",()=>{
 const db=openDatabase(":memory:");try {
  db.exec("INSERT INTO users VALUES('u','u@example.test','u','hash');INSERT INTO sites(id,name) VALUES('s','site');");
  for(let i=0;i<51;i++)db.prepare("INSERT INTO daily_journals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(`j${i}`,"s",`2026-${i<30?'09':'10'}-${String(i%30+1).padStart(2,'0')}`,JSON.stringify({workSummary:`same %_ ${i}`,workLocations:"x",observations:"find me"}),"draft",1,"u",null,"",null,String(i),String(i));
  const first=readDailyRegister(db,"s",dailyRegisterQuery.parse({q:"%_"}));assert.equal(first.total,51);assert.equal(first.items.length,50);assert.equal(first.hasMore,true);
  const second=readDailyRegister(db,"s",dailyRegisterQuery.parse({q:"%_",offset:"50"}));assert.equal(second.items.length,1);assert.equal(second.hasMore,false);
  assert.equal(readDailyRegister(db,"s",dailyRegisterQuery.parse({q:"absent"})).total,0);
  assert.equal(dailyRegisterQuery.safeParse({from:"2026-10-02",to:"2026-10-01"}).success,false);
 }finally{db.close();}
});
