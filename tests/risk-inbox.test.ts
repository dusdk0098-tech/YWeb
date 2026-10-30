import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { methodFixture } from "./fixtures/risk-method-fixture.js";
import { riskInboxQuery } from "../server/risk-inbox.js";
async function seed() {
 const f=await methodFixture();
 let r=await f.reviewSend(`/risk-assessments/${f.doc.id}/actions`,{version:f.doc.version,hazardId:f.doc.body.hazards[0].id,planIndex:0,assigneeId:f.manager,due:"2026-11-01",reason:"Synthetic source action",confirmManualTracking:true});
 assert.equal(r.status,200,JSON.stringify(r.body));const action=r.body;
 r=await f.send("post","/risk-publications",{assessmentId:f.doc.id,assessmentVersion:f.doc.version,submissionHash:f.doc.submission_hash,recipientIds:[f.manager],statement:"Synthetic account-only statement",reason:"Synthetic publication",confirmAccountPublication:true});
 assert.equal(r.status,200,JSON.stringify(r.body));return {...f,action,publicationId:r.body.id};
}
test("personal inbox strict query has no alternate account or delivery controls",()=>{
 assert.deepEqual(riskInboxQuery.parse({}),{kind:"actions",offset:0});
 for(const q of [{userId:randomUUID()},{offset:-1},{offset:1.2},{offset:1000001},{kind:"opinions"},{send:true}])assert.equal(riskInboxQuery.safeParse(q).success,false);
});
test("personal inbox real app returns own minimal rows, stops superseded publications but retains assigned actions",async()=>{
 const f=await seed();try{
 const original=f.db.prepare("SELECT * FROM risk_actions").all();
 let r=await f.agent.get(f.base+"/risk-inbox?kind=actions");assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.items.length,1);assert.equal(r.body.counts.ownAssigned,1);assert.equal(r.body.items[0].actionable,true);assert.equal(r.body.items[0].due,"2026-11-01");
 assert.deepEqual(Object.keys(r.body.items[0]).sort(),["kind","id","title","assessmentId","submissionVersion","submissionHash","sourceHasSuccessor","actionable","stopReason","due","task"].sort());
 r=await f.reviewAgent.get(f.base+"/risk-inbox?kind=actions");assert.equal(r.body.items.length,0);assert.equal(r.body.counts.ownAssigned,0);
 r=await f.agent.get(f.base+"/risk-inbox?kind=publications");assert.equal(r.body.items.length,1);assert.equal(r.body.counts.ownPublicationAllowed,1);assert.equal(r.body.counts.ownPublicationStopped,0);assert.equal(r.body.items[0].id,f.publicationId);assert.equal("targets" in r.body.items[0],false);assert.equal("acknowledgements" in r.body.items[0],false);
 assert.equal((await f.reviewAgent.get(f.base+"/risk-inbox?kind=publications")).body.items.length,0);
 assert.deepEqual(f.db.prepare("SELECT * FROM risk_actions").all(),original);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM risk_publication_acks").get()?.n,0);
 assert.equal((await f.reviewSend(`/risk-assessments/${f.doc.id}/revise`,{version:f.doc.version,reason:"Synthetic correction",authorId:f.manager})).status,200);
 r=await f.agent.get(f.base+"/risk-inbox?kind=actions");assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].sourceHasSuccessor,true);assert.equal(r.body.items[0].actionable,true);
 r=await f.agent.get(f.base+"/risk-inbox?kind=publications");assert.equal(r.body.items[0].actionable,false);assert.equal(r.body.counts.ownPublicationAllowed,0);assert.equal(r.body.counts.ownPublicationStopped,1);
 f.db.prepare("UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?").run(f.site,f.manager);
 r=await f.agent.get(f.base+"/risk-inbox?kind=actions");assert.equal(r.body.counts.ownAssigned,1);assert.equal(r.body.counts.ownReportAllowed,0);assert.equal(r.body.items[0].stopReason,"current_role_cannot_report");assert.equal(r.body.counts.reviewEligible,null);
 assert.equal((await f.agent.get(f.base+"/risk-inbox?kind=reviews")).status,403);
 f.db.prepare("DELETE FROM memberships WHERE site_id=? AND user_id=?").run(f.site,f.manager);assert.equal((await f.agent.get(f.base+"/risk-inbox")).status,403);
 }finally{f.db.close();}
});
test("personal inbox review queue excludes own authorship and hides permission-scoped count",async()=>{
 const f=await methodFixture();try{
 let r=await f.send("post","/risk-assessments",{body:f.body,criteriaId:f.doc.criteria_id});assert.equal(r.status,200);const id=r.body.id;
 r=await f.send("post",`/risk-assessments/${id}/submit`,{version:1,reason:"Synthetic submission",confirmRecordOnly:true});assert.equal(r.status,200);
 r=await f.agent.get(f.base+"/risk-inbox?kind=reviews");assert.equal(r.status,200);assert.equal(r.body.counts.reviewEligible,0);assert.equal(r.body.items.length,0);
 r=await f.reviewAgent.get(f.base+"/risk-inbox?kind=reviews");assert.equal(r.status,200);assert.equal(r.body.counts.reviewEligible,1);assert.equal(r.body.items[0].id,id);
 f.db.prepare("UPDATE memberships SET role='editor' WHERE site_id=? AND user_id=?").run(f.site,f.reviewer);
 r=await f.reviewAgent.get(f.base+"/risk-inbox?kind=actions");assert.equal(r.body.counts.reviewEligible,null);assert.equal((await f.reviewAgent.get(f.base+"/risk-inbox?kind=reviews")).status,403);
 const other=randomUUID();f.db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(other,"Other synthetic");f.db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(other,f.manager,"manager");
 r=await f.agent.get(`/api/sites/${other}/risk-inbox`);assert.equal(r.body.items.length,0);assert.equal(r.body.counts.ownAssigned,0);
 }finally{f.db.close();}
});
test("personal inbox refresh follows report/reassignment and own ack/withdrawal/republication without inherited completion",async()=>{
 const f=await seed();try{
 const path=`/risk-actions/${f.action.id}`;
 let r=await f.send("post",path+"/report",{version:f.action.version,text:"Synthetic human report",claimedLocalDate:"2026-10-28",reason:"Synthetic report",confirmHumanReport:true});assert.equal(r.status,200,JSON.stringify(r.body));
 assert.equal((await f.agent.get(f.base+"/risk-inbox")).body.items.length,0);
 r=await f.reviewSend(path+"/assign",{version:r.body.version,assigneeId:f.reviewer,due:"2026-11-01",reason:"Synthetic reassignment"});assert.equal(r.status,200);
 assert.equal((await f.agent.get(f.base+"/risk-inbox")).body.items.length,0);assert.equal((await f.reviewAgent.get(f.base+"/risk-inbox")).body.items.length,1);
 const p=(await f.agent.get(f.base+`/risk-publications/${f.publicationId}`)).body;
 // A viewer can still acknowledge their own active target publication.
 f.db.prepare("UPDATE memberships SET role='viewer' WHERE site_id=? AND user_id=?").run(f.site,f.manager);
 r=await f.agent.get(f.base+"/risk-inbox?kind=publications");assert.equal(r.body.items[0].actionable,true);
 r=await f.send("post",`/risk-publications/${p.id}/acknowledge`,{version:p.version,publicationHash:p.publicationHash,submissionHash:p.publication.source.submissionHash,confirmOwnAccount:true});assert.equal(r.status,200);
 assert.equal((await f.agent.get(f.base+"/risk-inbox?kind=publications")).body.items.length,0);
 f.db.prepare("UPDATE memberships SET role='manager' WHERE site_id=? AND user_id=?").run(f.site,f.manager);
 r=await f.send("post",`/risk-publications/${p.id}/withdraw`,{version:p.version,reason:"Synthetic withdrawal"});assert.equal(r.status,200);
 r=await f.send("post","/risk-publications",{assessmentId:f.doc.id,assessmentVersion:f.doc.version,submissionHash:f.doc.submission_hash,recipientIds:[f.manager],statement:"New publication",reason:"Synthetic republish",confirmAccountPublication:true});assert.equal(r.status,200);const next=r.body.id;
 r=await f.agent.get(f.base+"/risk-inbox?kind=publications");assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].id,next);assert.notEqual(next,p.id);
 r=await f.send("post",`/risk-publications/${next}/withdraw`,{version:1,reason:"Synthetic stop"});assert.equal(r.status,200);
 assert.equal((await f.agent.get(f.base+"/risk-inbox?kind=publications")).body.items.length,0);
 // Withdrawing publications never cancels the separate assigned action.
 assert.equal((await f.reviewAgent.get(f.base+"/risk-inbox")).body.counts.ownAssigned,1);
 }finally{f.db.close();}
});
test("personal inbox actual API 50/51 boundary has stable pages and exact category counts",async()=>{
 const f=await methodFixture();try{
 const docs:{id:string;version:number}[]=[];
 for(let i=0;i<51;i++){
  let r=await f.send("post","/risk-assessments",{body:{...f.body,title:`Synthetic inbox ${String(i).padStart(2,"0")}`},criteriaId:f.doc.criteria_id});assert.equal(r.status,200);
  r=await f.send("post",`/risk-assessments/${r.body.id}/submit`,{version:1,reason:"Synthetic page fixture",confirmRecordOnly:true});assert.equal(r.status,200);docs.push({id:r.body.id,version:r.body.version});
 }
 const review0=(await f.reviewAgent.get(f.base+"/risk-inbox?kind=reviews")).body, review1=(await f.reviewAgent.get(f.base+"/risk-inbox?kind=reviews&offset=50")).body;
 assert.equal(review0.items.length,50);assert.equal(review0.hasMore,true);assert.equal(review0.counts.reviewEligible,51);assert.equal(review1.items.length,1);assert.equal(review1.hasMore,false);assert.equal(new Set([...review0.items,...review1.items].map(r=>r.id)).size,51);
 for(const d of docs){
  let r=await f.reviewSend(`/risk-assessments/${d.id}/review`,{version:d.version,decision:"accepted",reason:"Synthetic record review",confirmRecordOnly:true});assert.equal(r.status,200);const doc=r.body.record;
  r=await f.send("post","/risk-publications",{assessmentId:doc.id,assessmentVersion:doc.version,submissionHash:doc.submission_hash,recipientIds:[f.manager],statement:"Synthetic statement",reason:"Synthetic publication",confirmAccountPublication:true});assert.equal(r.status,200);
  r=await f.reviewSend(`/risk-assessments/${doc.id}/actions`,{version:doc.version,hazardId:doc.body.hazards[0].id,planIndex:0,assigneeId:f.manager,due:"2026-11-01",reason:"Synthetic page action",confirmManualTracking:true});assert.equal(r.status,200);
 }
 for(const kind of ["actions","publications"]){
  const first=await f.agent.get(f.base+`/risk-inbox?kind=${kind}`),second=await f.agent.get(f.base+`/risk-inbox?kind=${kind}&offset=50`);
  assert.equal(first.status,200);assert.equal(second.status,200);assert.equal(first.body.items.length,50);assert.equal(first.body.hasMore,true);assert.equal(second.body.items.length,1);assert.equal(second.body.hasMore,false);assert.equal(first.body.counts.ownAssigned,51);assert.equal(first.body.counts.ownPublicationAllowed,51);
  assert.equal(new Set([...first.body.items,...second.body.items].map(r=>r.id)).size,51);
  assert.deepEqual((await f.agent.get(f.base+`/risk-inbox?kind=${kind}`)).body.items,first.body.items);
 }
 assert.equal((await f.reviewAgent.get(f.base+"/risk-inbox?kind=reviews")).body.counts.reviewEligible,0);
 }finally{f.db.close();}
});
