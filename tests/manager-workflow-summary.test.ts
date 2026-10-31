import { test } from "node:test";
import { closeReady } from "./fixtures/cost-close-ready.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { readManagerOverview, overviewQuery } from "../server/manager-overview.js";
import { managerCostSummary } from "../server/manager-workflow-summary.js";
test("manager cost optional month separates exact open/closed/reopened sums and never exposes rows or people",async()=>{
 const db=openDatabase(":memory:");try {
  const user=randomUUID(),site=randomUUID(),password="synthetic-manager-password",origin="http://127.0.0.1:3000";
  db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(user,"private@example.test","PRIVATE PERSON",await argon2.hash(password));db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site,"Site");db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site,user,"manager");
  const app=await createApp(db,{origin,secret:"synthetic-overview-secret-".repeat(3)}),agent=request.agent(app);let r=await agent.get("/api/session");r=await agent.post("/api/login").set("Origin",origin).set("x-csrf-token",r.body.csrf).send({email:"private@example.test",password});assert.equal(r.status,200);const csrf=r.body.csrf;
  const post=(path:string,body:object)=>agent.post(`/api/sites/${site}${path}`).set("Origin",origin).set("x-csrf-token",csrf).set("idempotency-key",randomUUID()).send(body);
  r=await post("/cost-periods",{month:"2026-10",openingNote:"PRIVATE OPENING",categories:[{label:"PRIVATE CATEGORY",plan:"10",opening:"0.000001"}]});assert.equal(r.status,200);let p=r.body;
  r=await post(`/cost-periods/${p.id}/expenses`,{version:p.version,expense:{categoryId:p.categories[0].id,spendDate:"2026-10-28",description:"PRIVATE EXPENSE",quantity:"0.000001",unitPriceWon:"3"}});assert.equal(r.status,200);p=r.body.period;
  const get=()=>agent.get("/api/manager-overview?asOfDate=2026-10-28&costMonth=2026-10");
  r=await get();assert.equal(r.status,200);let value=r.body.sites[0].cost;assert.equal(value.status,"available");assert.equal(value.value.state,"open");assert.equal(value.value.totals.current,"0.000003");assert.equal(value.value.totals.cumulative,"0.000004");assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE|private@example|description|closedBy|created_by/);
  assert.equal((await agent.get("/api/manager-overview?asOfDate=2026-10-28")).body.sites[0].cost,undefined);
  assert.equal((await agent.get("/api/manager-overview?asOfDate=2026-10-28&costMonth=2026-11")).body.sites[0].cost.value.kind,"no_period");
  closeReady(db);r=await post(`/cost-periods/${p.id}/close`,{version:p.version,reason:"Manual close"});assert.equal(r.status,200);p=r.body.period||r.body;
  r=await get();value=r.body.sites[0].cost;assert.equal(value.status,"available",JSON.stringify(value));assert.equal(value.value.state,"closed");assert.match(value.value.closure.hash,/^[a-f0-9]{64}$/);const before=r.body.fingerprint;
  r=await post(`/cost-periods/${p.id}/reopen`,{version:p.version,reason:"Manual reopen"});assert.equal(r.status,200);
  r=await get();assert.equal(r.body.sites[0].cost.value.state,"open");assert.equal(r.body.sites[0].cost.value.closure,null);assert.notEqual(r.body.fingerprint,before);
  const print=await agent.get(`/api/manager-overview/print?asOfDate=2026-10-28&costMonth=2026-10&expectedFingerprint=${r.body.fingerprint}`);assert.equal(print.status,200);assert.match(print.text,/비용 조회 월 2026-10/);assert.doesNotMatch(print.text,/PRIVATE PERSON|PRIVATE CATEGORY|PRIVATE EXPENSE/);
  assert.equal((await agent.get(`/api/manager-overview/print?asOfDate=2026-10-28&costMonth=2026-10&expectedFingerprint=${before}`)).status,409);
  db.prepare("UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?").run(site,user);
  assert.equal((await get()).body.sites.length,0);assert.equal((await agent.get(`/api/manager-overview?asOfDate=2026-10-28&siteIds=${site}&costMonth=2026-10`)).status,403);
 }finally{db.close();}
});
test("new overview sections fail unavailable rather than zero and retain default legacy values",()=>{
 const db=openDatabase(":memory:");try {
  db.exec("INSERT INTO users VALUES('u','u@example.test','u','hash');INSERT INTO sites(id,name) VALUES('s','Site');INSERT INTO memberships VALUES('s','u','manager');");
  const q=overviewQuery.parse({asOfDate:"2026-10-28"}),first=readManagerOverview(db,"u",q);assert.equal(first.sites[0].workflow.risk.status,"available");assert.equal(first.sites[0].workflow.meetingFollowups.status,"available");
  db.exec("ALTER TABLE minutes_followups RENAME TO synthetic_unavailable_followups");
  const next=readManagerOverview(db,"u",q);assert.deepEqual(next.sites[0].workflow.meetingFollowups,{status:"unavailable"});assert.deepEqual(next.sites[0].hazards,first.sites[0].hazards);assert.deepEqual(next.sites[0].tasks,first.sites[0].tasks);assert.notEqual(next.fingerprint,first.fingerprint);
  assert.deepEqual(managerCostSummary(db,"s","2026-10"),{status:"available",value:{kind:"no_period",month:"2026-10"}});
  db.exec("ALTER TABLE cost_periods RENAME TO synthetic_unavailable_costs");assert.deepEqual(managerCostSummary(db,"s","2026-10"),{status:"unavailable"});
 }finally{db.close();}
});

test("site workflow counts keep prior unresolved work and distinguish actual inspection leaves without personal fields",()=>{
 const db=openDatabase(":memory:");try {
  db.exec("INSERT INTO users VALUES('u','u@example.test','PRIVATE NAME','hash');INSERT INTO sites(id,name) VALUES('s','Site'),('other','Other');INSERT INTO memberships VALUES('s','u','manager');");
  for(const [id,parent,status] of [["plan-old",null,"archived"],["plan-new","plan-old","draft"]])db.prepare("INSERT INTO work_plans VALUES(?,?,?, ?,1,?,?,?,NULL,'t','t')").run(id,"s","{}",status,"u",parent,"");
  db.prepare("INSERT INTO work_plan_document_reviews VALUES(?,?,'submitted',1,NULL,'t')").run("plan-old","synthetic-hash");
  db.prepare("INSERT INTO inspection_templates(id,site_id,body,status,version,created_at) VALUES('template','s','{}','draft',1,'t')").run();
  for(const [id,parent,status] of [["inspection-old",null,"returned"],["inspection-new","inspection-old","submitted"]])db.prepare("INSERT INTO inspections(id,site_id,template_id,template_snapshot,owner_id,parent_id,body,status,version,created_at) VALUES(?,'s','template','{}','u',?,'{}',?,1,'t')").run(id,parent,status);
  for(const id of ["meeting-old","meeting-new"])db.prepare("INSERT INTO minutes VALUES(?,'s','{}',1,'u','t','t')").run(id);
  db.prepare("INSERT INTO minutes_records VALUES('meeting-new','draft','meeting-old','Correction')").run();
  for(const [id,meeting,status,due] of [["follow-old","meeting-old","assigned","2026-10-27"],["follow-current","meeting-new","reported","2026-10-28"]])db.prepare("INSERT INTO minutes_followups(id,site_id,minutes_id,action_index,source,source_hash,status,assignee_id,due,version,created_at,updated_at) VALUES(?,'s',?,0,'{}','hash',?,'u',?,1,'t','t')").run(id,meeting,status,due);
  const before=db.prepare("SELECT total_changes() n").get();
  const r=readManagerOverview(db,"u",overviewQuery.parse({asOfDate:"2026-10-28"})),w=r.sites[0].workflow;
  assert.equal(w.documents.status,"available");if(w.documents.status!=="available")throw Error("missing");
  assert.deepEqual(w.documents.value.workPlansSubmitted,{currentLeaf:0,priorWithSuccessor:1});assert.equal(w.documents.value.inspections.currentLeaf.submitted,1);assert.equal(w.documents.value.inspections.priorWithSuccessor.returned,1);
  assert.equal(w.meetingFollowups.status,"available");if(w.meetingFollowups.status!=="available")throw Error("missing");
  assert.equal(w.meetingFollowups.value.priorWithCorrection.assigned.beforeDate,1);assert.equal(w.meetingFollowups.value.current.reported.onDate,1);
  assert.deepEqual(db.prepare("SELECT total_changes() n").get(),before);assert.doesNotMatch(JSON.stringify(r),/PRIVATE NAME|assignee|owner_id|source_hash/);
  db.prepare("UPDATE minutes_followups SET due='2026-02-30' WHERE id='follow-old'").run();
  const bad=readManagerOverview(db,"u",overviewQuery.parse({asOfDate:"2026-10-28"}));assert.deepEqual(bad.sites[0].workflow.meetingFollowups,{status:"unavailable"});assert.equal(bad.sites[0].workflow.documents.status,"available");
 }finally{db.close();}
});
test("manager cost1000 retained rows stays exact;1001 or malformed closed hash is unavailable rather than zero",()=>{
 const db=openDatabase(":memory:");try {
  db.exec("INSERT INTO users VALUES('u','u@example.test','u','hash');INSERT INTO sites(id,name) VALUES('s','Site');");
  const categories=JSON.stringify([{id:"c",label:"Private label",plan:"10",opening:"0"}]);
  db.prepare("INSERT INTO cost_periods VALUES('p','s','2026-10',?,'private','open',1,NULL,NULL,NULL,'u','t','t')").run(categories);
  const insert=db.prepare("INSERT INTO cost_expenses VALUES(?,'p','c','2026-10-28','Private description','0.000001','1','0.000001','active',1,'u',?,?)");
  db.exec("BEGIN");for(let i=0;i<1000;i++)insert.run(`e${i}`,String(i),String(i));db.exec("COMMIT");
  let value=managerCostSummary(db,"s","2026-10");assert.equal(value.status,"available");if(value.status!=="available"||value.value.kind!=="period")throw Error("missing");assert.equal(value.value.totals.current,"0.001");
  insert.run("overflow","last","last");assert.deepEqual(managerCostSummary(db,"s","2026-10"),{status:"unavailable"});
  db.prepare("INSERT INTO cost_periods VALUES('closed','s','2026-11',?,'private','open',1,NULL,NULL,NULL,'u','t','t')").run(categories);
  db.prepare("INSERT INTO cost_closures VALUES('broken','closed',1,?,'invalid-hash','t')").run(JSON.stringify({schema:1,id:"broken",site:{id:"s"},period:{id:"closed",month:"2026-11"},policy:"exact-six-decimal-whole-won-price-v1"}));
  db.exec("UPDATE cost_periods SET status='closed',version=2,current_close_id='broken' WHERE id='closed'");
  value=managerCostSummary(db,"s","2026-11");assert.deepEqual(value,{status:"unavailable"});
 }finally{db.close();}
});
