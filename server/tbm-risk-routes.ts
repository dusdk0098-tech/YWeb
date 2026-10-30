import type { Express } from "express";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { currentTbmRiskSource, selectTbmRiskReference, storeTbmRiskReference, tbmRiskReference, tbmRiskReferenceInput, type TbmRiskReference } from "./tbm-risk-reference.js";
// Invoked inside registerTbmRoutes, with its existing full(get(...)) callback.
export function registerTbmRiskReferenceRoutes(app: Express, db: Db, {access, mutate}: SiteOperations,
  full: (siteId: string, sessionId: string) => unknown) {
  const path = "/api/sites/:siteId/tbm/:id/risk-reference";
  function session(siteId: string, id: string) {
    const row = db.prepare("SELECT id,status,version FROM tbm_sessions WHERE site_id=? AND id=?").get(siteId,id) as {id:string;status:string;version:number} | undefined;
    if (!row) throw new HttpError(404, "TBM 기록을 찾을 수 없습니다.");
    return row;
  }
  app.put(path, (req,res) => {
    access(req,true,true);
    const input = tbmRiskReferenceInput.parse(req.body), siteId = String(req.params.siteId), id = String(req.params.id);
    mutate(req,res,`site:${siteId}:tbm:${id}:risk-reference`,input, () => {
      const row = session(siteId,id);
      if (row.status !== "draft" || row.version !== input.version) throw new HttpError(409,"최신 TBM 초안에서 출처를 변경하세요.");
      const ref = input.source ? selectTbmRiskReference(db,siteId,input.source) : null;
      const change = db.prepare("UPDATE tbm_sessions SET version=version+1,updated_at=? WHERE id=? AND site_id=? AND status='draft' AND version=?")
        .run(new Date().toISOString(),id,siteId,input.version);
      if (!change.changes) throw new HttpError(409,"TBM 버전 충돌입니다.");
      storeTbmRiskReference(db,id,ref);
      audit(db,req.session.userId!,siteId,"tbm.risk-reference.changed",id);
      return full(siteId,id);
    }, () => { access(req,true,true); });
  });
  app.get(path + "/source", (req,res) => {
    access(req);
    const siteId = String(req.params.siteId), id = String(req.params.id), row = session(siteId,id);
    let ref = tbmRiskReference(db,id);
    if (row.status === "finalized") {
      const snapshot = db.prepare("SELECT body FROM tbm_snapshots WHERE session_id=?").get(id) as {body:string} | undefined;
      if (!snapshot) throw new HttpError(409,"TBM 보관본이 없습니다.");
      const body = JSON.parse(snapshot.body) as {riskReference?: {reference:TbmRiskReference} | null};
      ref = body.riskReference?.reference ?? null;
    }
    if (!ref) throw new HttpError(404,"연결된 위험성평가가 없습니다.");
    res.json(currentTbmRiskSource(db,siteId,ref));
  });
}
