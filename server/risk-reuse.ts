import type { Express } from "express";
import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { assessment, assessmentRecord, riskEvent } from "./risk-core.js";
import { fixedRiskSubmission } from "./risk-review.js";
import { riskHash } from "./risk-model.js";
import { methodCriteriaInput, validateMethodCriteria } from "./risk-methods.js";
import { account } from "./inspection-model.js";
import { reuseInput, reuseBody } from "./risk-reuse-model.js";
export type RiskReuseProvenance = {
  policyVersion: 1;
  sourceId: string;
  sourceSubmissionVersion: number;
  sourceSubmissionHash: string;
  criteriaId: string;
  criteriaVersion: number;
  criteriaHash: string;
  mapping: { sourceHazardId: string; newHazardId: string }[];
  includePlans: boolean;
  actor: { id: string; name: string };
  at: string;
  reason: string;
};
export function reuseProvenance(db: Db, site: string, id: string): RiskReuseProvenance | null {
  const row = db.prepare("SELECT provenance,provenance_hash FROM risk_reuse_sources WHERE site_id=? AND assessment_id=?").get(site,id) as { provenance: string; provenance_hash: string } | undefined;
  if (!row) return null;
  const value = JSON.parse(row.provenance) as RiskReuseProvenance;
  if (riskHash(value) !== row.provenance_hash) throw new HttpError(409,"재사용 출처 보관본이 일치하지 않습니다.");
  return value;
}
export function registerRiskReuse(app: Express, db: Db, {access,mutate}: SiteOperations) {
  const base = "/api/sites/:siteId/risk-assessments/:id";
  app.get(base+"/reuse-source", (req,res) => {
    access(req); const site=String(req.params.siteId), id=String(req.params.id);
    assessment(db,site,id); res.json({ source: reuseProvenance(db,site,id) });
  });
  app.post(base+"/reuse", (req,res) => {
    access(req,true); const input=reuseInput.parse(req.body), site=String(req.params.siteId), id=String(req.params.id);
    mutate(req,res,`risk:assessment:reuse:${site}:${id}`,input,() => {
      const old=assessmentRecord(assessment(db,site,id));
      if (old.status === "draft" || old.version !== input.version) throw new HttpError(409,"고정 제출 문서를 다시 조회하세요.");
      const fixed=fixedRiskSubmission(old);
      if (fixed.version !== input.submissionVersion || old.submission_hash !== input.submissionHash) throw new HttpError(409,"선택한 제출본이 바뀌었습니다.");
      const c=db.prepare("SELECT version,status,confirmed_snapshot,confirmed_hash FROM risk_criteria WHERE site_id=? AND id=?").get(site,fixed.criteria.id) as {version:number;status:string;confirmed_snapshot:string|null;confirmed_hash:string|null}|undefined;
      const criteriaHash=riskHash(fixed.criteria);
      if (!c || c.status !== "confirmed" || c.version !== fixed.criteria.version || c.confirmed_hash !== criteriaHash || !c.confirmed_snapshot || riskHash(JSON.parse(c.confirmed_snapshot)) !== criteriaHash)
        throw new HttpError(409,"같은 현장의 확인 기준 보관본을 확인할 수 없습니다.");
      validateMethodCriteria(methodCriteriaInput.parse(fixed.criteria.body));
      const {body,mapping}=reuseBody(fixed.body,input), next=randomUUID(), at=new Date().toISOString();
      db.prepare("INSERT INTO risk_assessments(id,site_id,author_id,version,body,criteria_id,criteria_snapshot,criteria_hash,created_at,updated_at) VALUES(?,?,?,1,?,?,?,?,?,?)")
        .run(next,site,req.session.userId!,JSON.stringify(body),fixed.criteria.id,JSON.stringify(fixed.criteria),criteriaHash,at,at);
      const provenance:RiskReuseProvenance={policyVersion:1,sourceId:id,sourceSubmissionVersion:fixed.version,sourceSubmissionHash:old.submission_hash!,criteriaId:fixed.criteria.id,criteriaVersion:fixed.criteria.version,criteriaHash,mapping,includePlans:input.includePlans,actor:account(db,req.session.userId!),at,reason:input.reason};
      db.prepare("INSERT INTO risk_reuse_sources VALUES(?,?,?,?,?)").run(next,site,id,JSON.stringify(provenance),riskHash(provenance));
      const row=assessmentRecord(assessment(db,site,next));
      riskEvent(db,req,"assessment",row,"reused_created",`원 제출본 ${id} v${fixed.version}; ${input.reason}`);
      return row;
    },()=>{access(req,true);});
  });
}
