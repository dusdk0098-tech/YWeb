import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../server/db.js";
import { readRiskRegister,riskRegisterQuery } from "../server/risk-register.js";
function fixture(){
 const db=openDatabase(":memory:"),site=randomUUID(),author=randomUUID();
 db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(author,"synthetic@example.test","Synthetic","not-a-login-fixture");db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site,"Synthetic");
 function add({method="product",status="draft",date="2026-10-28",title="Title",task="Task",scope="Scope",successor=null,created="2026-10-28T00:00:00.000Z"}:{method?:string;status?:string;date?:string;title?:string;task?:string;scope?:string;successor?:string|null;created?:string}={}){
  const id=randomUUID(),body={method,title,date,workScope:scope,hazards:[{task},{task}]};
  db.prepare("INSERT INTO risk_assessments(id,site_id,author_id,version,body,created_at,updated_at,status,successor_id) VALUES(?,?,?,1,?,?,?,?,?)").run(id,site,author,JSON.stringify(body),created,created,status,successor);return id;
 }
 return{db,site,author,add};
}
test("register date bounds, four methods/statuses, literal keyword and leaf distinction",()=>{
 const f=fixture();try{
  const leaf=f.add({method:"narrative",status:"draft",date:"2026-11-01"});
  const prior=f.add({method:"product",status:"accepted",date:"2026-10-28",title:"Literal %_ ' 한글",successor:leaf});
  f.add({method:"three_level",status:"submitted",date:"2026-10-29",scope:"Scope %_ ' 한글"});
  f.add({method:"checklist",status:"returned",date:"2026-10-30",task:"Task %_ ' 한글"});
  const read=(q:unknown)=>readRiskRegister(f.db,f.site,q,()=>{});
  assert.equal(read({}).total,4);assert.equal(read({keyword:"%_ ' 한글"}).total,3);assert.equal(read({keyword:"literal"}).total,0);
  assert.deepEqual(read({lineage:"prior"}).items.map(r=>r.id),[prior]);assert.equal(read({lineage:"leaf"}).total,3);
  assert.equal(read({dateFrom:"2026-10-28",dateTo:"2026-10-30"}).total,3);assert.equal(read({dateTo:"2026-10-28"}).total,1);assert.equal(read({dateFrom:"2026-11-01"}).total,1);
  for(const method of ["product","three_level","checklist","narrative"])assert.equal(read({method}).total,1);
  for(const status of ["draft","submitted","accepted","returned"])assert.equal(read({status}).total,1);
  assert.equal(read({keyword:"Task %_"}).total,1); // two matching hazards are one document
  assert.equal(riskRegisterQuery.safeParse({dateFrom:"2026-11-01",dateTo:"2026-10-28"}).success,false);
  assert.equal(riskRegisterQuery.safeParse({dateFrom:"2026-02-30"}).success,false);
  assert.equal(riskRegisterQuery.safeParse({companyId:randomUUID()}).success,false);
  assert.equal(riskRegisterQuery.safeParse({keyword:"x".repeat(101)}).success,false);
 }finally{f.db.close();}
});
test("register deterministic offset50/current count, read-only and scoped errors",()=>{
 const f=fixture();try{
  const ids=Array.from({length:51},()=>f.add()).sort();
  const before=f.db.prepare("SELECT total_changes() n").get();
  const first=readRiskRegister(f.db,f.site,{},()=>{}),second=readRiskRegister(f.db,f.site,{offset:50},()=>{});
  assert.equal(first.total,51);assert.equal(first.items.length,50);assert.equal(first.hasMore,true);assert.deepEqual(first.items.map(r=>r.id),ids.slice(0,50));assert.deepEqual(second.items.map(r=>r.id),ids.slice(50));assert.equal(second.hasMore,false);
  assert.equal(readRiskRegister(f.db,randomUUID(),{},()=>{}).total,0);assert.deepEqual(f.db.prepare("SELECT total_changes() n").get(),before);
  assert.throws(()=>readRiskRegister(f.db,f.site,{},()=>{throw Error("denied");}),/denied/);
  f.add({method:"unknown"});assert.throws(()=>readRiskRegister(f.db,f.site,{method:"product"},()=>{}),/일부 문서를 숨기지/);
 }finally{f.db.close();}
});
