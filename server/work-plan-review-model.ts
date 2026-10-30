import { validatePacketSnapshot } from "./work-plan-packet.js";
import { validateWorkPlanAttachments } from "./work-plan-attachment-model.js";
import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import { journalHash } from "./daily-journal-sources.js";
import { planSourceFacts } from "./work-plan-sources.js";
import type { WorkPlanRow,WorkPlanSnapshot } from "./work-plan-model.js";
export type SubmittedWorkPlan=WorkPlanSnapshot&{recordKind:"author_submission"};
export type WorkPlanReviewRow={plan_id:string;submission_hash:string;status:"submitted"|"accepted"|"returned";version:number;decision:string|null;submitted_at:string};
export type WorkPlanDecision={kind:"accepted"|"returned";actor:{id:string;name:string};at:string;reason:string;submissionHash:string;nextDraftId:string|null;sourceStateAtDecision:"current"|"changed"|"unavailable"};
export function planReview(db:Db,id:string){return db.prepare("SELECT * FROM work_plan_document_reviews WHERE plan_id=?").get(id) as WorkPlanReviewRow|undefined;}
export function fixedPlanSubmission(db:Db,row:WorkPlanRow,review:WorkPlanReviewRow){
 const saved=db.prepare("SELECT body,hash FROM work_plan_snapshots WHERE plan_id=?").get(row.id) as {body:string;hash:string}|undefined;
 if(row.status!=="archived"||!saved)throw new HttpError(409,"고정 제출본이 없습니다.");
 const body=JSON.parse(saved.body) as SubmittedWorkPlan;
 validateWorkPlanAttachments(db,row.id,body); validatePacketSnapshot(body);
 if(body.recordKind!=="author_submission"||journalHash(body)!==saved.hash||saved.hash!==review.submission_hash||body.id!==row.id||body.site.id!==row.site_id||body.author.id!==row.author_id||body.version!==row.version||JSON.stringify(body.body)!==row.body||body.source.facts.siteId!==row.site_id||journalHash(body.source.facts)!==body.source.fingerprint)throw new HttpError(409,"제출본 해시/출처가 일치하지 않습니다.");
 return {body,hash:saved.hash};
}
export function currentPlanReferenceState(db:Db,row:WorkPlanRow,submitted:SubmittedWorkPlan):{state:"current"|"changed"|"unavailable";message:string}{
 try{const state=journalHash(planSourceFacts(db,row.site_id,submitted.body))===submitted.source.fingerprint?"current":"changed";return {state,message:state==="current"?"현재 선택 참조가 제출 당시와 같습니다. 안전·자격·선임 판단이 아닙니다.":"장비/명부 참조가 제출 이후 변경되었습니다. 원 제출본은 변경되지 않습니다."};}
 catch(error){if(error instanceof HttpError&&(error.status===404||error.status===409))return {state:"unavailable",message:"선택 장비/명부가 퇴역·비활성 또는 조회 불가입니다. 원 제출본은 유지됩니다."};throw error;}
}
export function workPlanReviewView(db:Db,row:WorkPlanRow){const review=planReview(db,row.id);if(!review)return {kind:row.status==="archived"?"unreviewed_archive" as const:"draft" as const,review:null,referenceState:null};const fixed=fixedPlanSubmission(db,row,review);return {kind:"document_review" as const,review:{...review,decision:review.decision?JSON.parse(review.decision) as WorkPlanDecision:null},referenceState:currentPlanReferenceState(db,row,fixed.body)};}
export function preventPendingPlanRevision(db:Db,id:string){if(planReview(db,id)?.status==="submitted")throw new HttpError(409,"제출 검토 대기 중입니다. 먼저 문서 검토/보완반려를 기록하세요.");}
