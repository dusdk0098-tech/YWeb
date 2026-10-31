import { validatePacketReferences, resetPacketBody } from "./work-plan-packet.js";
import { fixedWorkPlanAttachments } from "./work-plan-attachment-model.js";
import type { Express,Request } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit,type Db } from "./db.js";
import { HttpError, canWriteSite,type SiteOperations } from "./site-operations.js";
import { account } from "./inspection-model.js";
import { companyPage } from "./companies.js";
import { revision } from "./validation.js";
import { completePlan } from "./work-plan-validation.js";
import { getWorkPlan,workPlanRecord,fullWorkPlan,type WorkPlanRow,type WorkPlanSnapshot } from "./work-plan-model.js";
import { planSourceFacts } from "./work-plan-sources.js";
import { journalHash } from "./daily-journal-sources.js";
import { planReview,fixedPlanSubmission,currentPlanReferenceState,workPlanReviewView,type WorkPlanDecision } from "./work-plan-review-model.js";
const reason=z.string().trim().min(1).max(1000),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const planSubmitInput=z.object({version:revision,reason,confirmDocumentOnly:z.literal(true)}).strict();
export const planReviewInput=z.discriminatedUnion("decision",[
 z.object({version:revision,submissionHash:hash,decision:z.literal("accepted"),reason,confirmDocumentOnly:z.literal(true)}).strict(),
 z.object({version:revision,submissionHash:hash,decision:z.literal("returned"),authorId:z.uuid(),reason,confirmDocumentOnly:z.literal(true)}).strict(),
]);
// Shared by legacy /archive and /submit so both fix the same checks and snapshot shape.
export function finalizeWorkPlan(db:Db,old:WorkPlanRow,author:ReturnType<typeof account>,archivedBy:ReturnType<typeof account>,now:string,submission:boolean){
 const current=workPlanRecord(old);if(!completePlan(current.body))throw new HttpError(400,"제출/보관 전 위치/작업설명/비상절차와 각 작업단계·절차·주의사항을 작성하세요.");
 validatePacketReferences(db,old.id,current.body);
 const source=current.source_capture;if(!source||source.facts.siteId!==old.site_id||journalHash(source.facts)!==source.fingerprint||journalHash(planSourceFacts(db,old.site_id,current.body))!==source.fingerprint)throw new HttpError(409,"선택 참조가 변경됐거나 취합되지 않았습니다. 작성자가 확인 후 다시 취합하세요.");
 const name=(db.prepare("SELECT name FROM sites WHERE id=?").get(old.site_id) as {name:string}).name;
 const snapshot:WorkPlanSnapshot={...(submission?{recordKind:"author_submission" as const}:{}),id:old.id,version:old.version+1,site:{id:old.site_id,name},author,parentId:old.parent_id,revisionReason:old.revision_reason,body:current.body,source,archivedBy,archivedAt:now,attachmentManifest:fixedWorkPlanAttachments(db,old.id)};
 const hash=journalHash(snapshot);db.prepare("UPDATE work_plans SET status='archived',version=version+1,updated_at=? WHERE id=?").run(now,old.id);db.prepare("INSERT INTO work_plan_snapshots VALUES(?,?,?)").run(old.id,JSON.stringify(snapshot),hash);
 return {snapshot,hash};
}
export function registerWorkPlanReview(app:Express,db:Db,{access,mutate}:SiteOperations){
 const base="/api/sites/:siteId/work-plans/:id";
 function row(req:Request){return getWorkPlan(db,String(req.params.siteId),String(req.params.id));}
 function author(req:Request){access(req,true);if(row(req).author_id!==req.session.userId)throw new HttpError(403,"작성 계정만 제출할 수 있습니다.");}
 function reviewer(req:Request){access(req,true,true);if(row(req).author_id===req.session.userId)throw new HttpError(403,"작성자와 다른 현장 관리자가 문서 검토를 기록해야 합니다.");}
 function eligible(site:string,id:string){if(!canWriteSite(db, site, id))throw new HttpError(400,"현재 현장의 작성 가능한 계정을 지정하세요.");}
 function reviewEvent(req:Request,id:string,version:number,event:string,why:string){const actor=account(db,req.session.userId!),now=new Date().toISOString();db.prepare("INSERT INTO work_plan_review_events(plan_id,version,event,actor_id,actor_name,at,reason,body) VALUES(?,?,?,?,?,?,?,?)").run(id,version,event,actor.id,actor.name,now,why,JSON.stringify(planReview(db,id)));audit(db,actor.id,String(req.params.siteId),"work_plan.document."+event,id);}
 app.get(base+"/document-review",(req,res)=>{access(req);res.json(workPlanReviewView(db,row(req)));});
 app.get(base+"/review-events",(req,res)=>{access(req);const old=row(req),q=companyPage.parse(req.query),rows=db.prepare("SELECT * FROM work_plan_review_events WHERE plan_id=? ORDER BY version LIMIT 51 OFFSET ?").all(old.id,q.offset);res.json({items:rows.slice(0,50),hasMore:rows.length>50});});
 app.post(base+"/submit",(req,res)=>{
  author(req);const v=planSubmitInput.parse(req.body);
  mutate(req,res,`work_plan:document:submit:${req.params.siteId}:${req.params.id}`,v,()=>{
   const old=row(req);if(old.status!=="draft"||old.version!==v.version)throw new HttpError(409,"최신 초안에서 제출하세요.");
   const now=new Date().toISOString(),actor=account(db,req.session.userId!),{snapshot:submitted,hash:submissionHash}=finalizeWorkPlan(db,old,actor,actor,now,true);
   db.prepare("INSERT INTO work_plan_document_reviews VALUES(?,?,'submitted',1,NULL,?)").run(old.id,submissionHash,now);
   db.prepare("INSERT INTO work_plan_events(plan_id,version,event,actor_id,actor_name,at,note) VALUES(?,?,?,?,?,?,?)").run(old.id,submitted.version,"submitted",actor.id,actor.name,now,v.reason);reviewEvent(req,old.id,1,"submitted",v.reason);return fullWorkPlan(db,row(req));
  },()=>author(req));
 });
 app.post(base+"/review",(req,res)=>{
  reviewer(req);const v=planReviewInput.parse(req.body);
  mutate(req,res,`work_plan:document:review:${req.params.siteId}:${req.params.id}`,v,()=>{
   const old=row(req),review=planReview(db,old.id);if(!review||review.status!=="submitted"||review.version!==v.version||review.submission_hash!==v.submissionHash||db.prepare("SELECT 1 FROM work_plans WHERE parent_id=?").get(old.id))throw new HttpError(409,"현재 제출 검토 상태/버전/해시를 확인하세요.");
   const submitted=fixedPlanSubmission(db,old,review),state=currentPlanReferenceState(db,old,submitted.body);
   if(v.decision==="accepted"&&state.state!=="current")throw new HttpError(409,"선택 참조가 변경되거나 사용 불가입니다. 보완반려 후 새 초안에서 참조를 다시 취합하세요.");
   const now=new Date().toISOString(),actor=account(db,req.session.userId!);let next:string|null=null;
   if(v.decision==="returned"){
    eligible(old.site_id,v.authorId);next=randomUUID();db.prepare("INSERT INTO work_plans VALUES(?,?,?,'draft',1,?,?,?,NULL,?,?)").run(next,old.site_id,JSON.stringify(resetPacketBody(submitted.body.body)),v.authorId,old.id,v.reason,now,now);
    db.prepare("INSERT INTO work_plan_events(plan_id,version,event,actor_id,actor_name,at,note) VALUES(?,1,'returned_draft_created',?,?,?,?)").run(next,actor.id,actor.name,now,v.reason);audit(db,actor.id,old.site_id,"work_plan.returned_draft_created",next);
   }
   const decision:WorkPlanDecision={kind:v.decision,actor,at:now,reason:v.reason,submissionHash:submitted.hash,nextDraftId:next,sourceStateAtDecision:state.state};
   db.prepare("UPDATE work_plan_document_reviews SET status=?,version=version+1,decision=? WHERE plan_id=?").run(v.decision,JSON.stringify(decision),old.id);reviewEvent(req,old.id,review.version+1,v.decision,v.reason);
   return {record:fullWorkPlan(db,row(req)),documentReview:workPlanReviewView(db,row(req)),nextDraft:next?fullWorkPlan(db,getWorkPlan(db,old.site_id,next)):null};
  },()=>reviewer(req));
 });
}
