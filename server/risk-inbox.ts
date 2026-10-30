import type { Express } from "express";
import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { riskActionRecord, type ActionRow } from "./risk-actions.js";
import { publicationView, type PublicationRow } from "./risk-publication-model.js";
import { assessmentRecord, type AssessmentRow } from "./risk-core.js";
import { fixedRiskSubmission } from "./risk-review.js";
export const riskInboxQuery = z.object({
  kind: z.enum(["actions", "publications", "reviews"]).default("actions"),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
}).strict();
export type RiskInboxKind = z.infer<typeof riskInboxQuery>["kind"];
export type RiskInboxItem = {
  kind: RiskInboxKind; id: string; title: string; assessmentId: string;
  submissionVersion: number; submissionHash: string;
  sourceHasSuccessor: boolean; actionable: boolean;
  stopReason: "current_role_cannot_report" | "source_not_current" | null;
  due?: string; task?: string;
};
export type RiskInbox = {
  siteId: string; retrievedAt: string; kind: RiskInboxKind; offset: number;
  counts: { ownAssigned: number; ownReportAllowed: number; ownPublicationAllowed: number; ownPublicationStopped: number; reviewEligible: number | null };
  items: RiskInboxItem[]; hasMore: boolean;
};
const actionsWhere = "a.site_id=? AND a.assignee_id=? AND a.status='assigned'";
const publicationsFrom = `FROM risk_publications p JOIN risk_assessments d ON d.id=p.assessment_id AND d.site_id=p.site_id
 WHERE p.site_id=? AND p.status='published'
 AND EXISTS(SELECT 1 FROM risk_publication_targets t WHERE t.publication_id=p.id AND t.user_id=?)
 AND NOT EXISTS(SELECT 1 FROM risk_publication_acks k WHERE k.publication_id=p.id AND k.user_id=?)`;
const reviewsWhere = "site_id=? AND status='submitted' AND author_id<>? AND successor_id IS NULL";
// The route supplies current site membership and server-session account. This
// query never accepts an alternate user or reads private opinion tables.
export function readRiskInbox(db: Db, siteId: string, userId: string, role: string, query: z.infer<typeof riskInboxQuery>): RiskInbox {
  if (query.kind === "reviews" && role !== "manager") throw new HttpError(403, "관리자 문서 검토 목록입니다.");
  const n = (sql: string, params: string[]) => Number((db.prepare(sql).get(...params) as {n:number}).n);
  const ownAssigned=n(`SELECT COUNT(*) n FROM risk_actions a WHERE ${actionsWhere}`,[siteId,userId]);
  const pubCounts=db.prepare(`SELECT COALESCE(SUM(CASE WHEN d.status='accepted' AND d.successor_id IS NULL THEN 1 ELSE 0 END),0) ready,
    COALESCE(SUM(CASE WHEN d.status='accepted' AND d.successor_id IS NULL THEN 0 ELSE 1 END),0) stopped ${publicationsFrom}`)
    .get(siteId,userId,userId) as {ready:number;stopped:number};
  let items:RiskInboxItem[],hasMore:boolean;
  if(query.kind==="actions") {
    const rows=db.prepare(`SELECT a.* FROM risk_actions a WHERE ${actionsWhere} ORDER BY a.due,a.id LIMIT 51 OFFSET ?`).all(siteId,userId,query.offset) as ActionRow[];
    hasMore=rows.length>50;items=rows.slice(0,50).map(row=>{
      const r=riskActionRecord(db,row),allowed=role!=="viewer";
      return {kind:"actions",id:r.id,title:r.source.assessmentTitle,assessmentId:r.assessment_id,
        submissionVersion:r.source.submissionVersion,submissionHash:r.source.submissionHash,
        sourceHasSuccessor:!!r.sourceDocument.successorId,actionable:allowed,
        stopReason:allowed?null:"current_role_cannot_report",due:r.due,task:r.source.hazard.task};
    });
  } else if(query.kind==="publications") {
    const rows=db.prepare(`SELECT p.* ${publicationsFrom} ORDER BY p.created_at DESC,p.id DESC LIMIT 51 OFFSET ?`).all(siteId,userId,userId,query.offset) as PublicationRow[];
    hasMore=rows.length>50;items=rows.slice(0,50).map(row=>{
      // Deliberately target-only projection, even for a manager. No target roster,
      // other acknowledgments, event history, or count is returned to this list.
      const r=publicationView(db,row,userId,false);
      return {kind:"publications",id:r.id,title:r.publication.source.title,assessmentId:r.publication.source.assessmentId,
        submissionVersion:r.publication.source.submissionVersion,submissionHash:r.publication.source.submissionHash,
        sourceHasSuccessor:r.sourceHasSuccessor,actionable:r.canAcknowledge,stopReason:r.canAcknowledge?null:"source_not_current"};
    });
  } else {
    const rows=db.prepare(`SELECT * FROM risk_assessments WHERE ${reviewsWhere} ORDER BY created_at,id LIMIT 51 OFFSET ?`).all(siteId,userId,query.offset) as AssessmentRow[];
    hasMore=rows.length>50;items=rows.slice(0,50).map(row=>{
      const r=assessmentRecord(row),fixed=fixedRiskSubmission(r);
      return {kind:"reviews",id:r.id,title:fixed.body.title,assessmentId:r.id,
        submissionVersion:fixed.version,submissionHash:r.submission_hash!,sourceHasSuccessor:false,actionable:true,stopReason:null};
    });
  }
  return {siteId,retrievedAt:new Date().toISOString(),kind:query.kind,offset:query.offset,
    counts:{ownAssigned,ownReportAllowed:role==="viewer"?0:ownAssigned,ownPublicationAllowed:pubCounts.ready,ownPublicationStopped:pubCounts.stopped,
      reviewEligible:role==="manager"?n(`SELECT COUNT(*) n FROM risk_assessments WHERE ${reviewsWhere}`,[siteId,userId]):null},items,hasMore};
}
export function registerRiskInbox(app:Express,db:Db,{access}:SiteOperations) {
  app.get("/api/sites/:siteId/risk-inbox",(req,res)=>{
    const query=riskInboxQuery.parse(req.query);
    db.exec("BEGIN DEFERRED");
    try {
      const role=access(req), result=readRiskInbox(db,String(req.params.siteId),req.session.userId!,role,query);
      db.exec("COMMIT");res.json(result);
    }catch(error){db.exec("ROLLBACK");throw error;}
  });
}
