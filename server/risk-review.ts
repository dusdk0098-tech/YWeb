import { SOLE_MANAGER_NOTE, soleManager } from "./sole-manager.js";
import { validateChecklistCoverage } from "./risk-checklist-model.js";
import type { Express, Request } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError, canWriteSite, type SiteOperations } from "./site-operations.js";
import { revision } from "./validation.js";
import { companyPage } from "./companies.js";
import { account } from "./inspection-model.js";
import { riskHash } from "./risk-model.js";
import {
  methodResults as riskResults,
  type MethodAssessment as RiskAssessmentInput,
  type MethodCriteria as RiskCriteria,
} from "./risk-methods.js";
import {
  assessment,
  assessmentRecord,
  riskEvent,
  type RiskSubmission,
  type RiskDecision,
  type RiskAssessmentRecord,
} from "./risk-core.js";
const reason = z.string().trim().min(1).max(1000);
export function validateRiskSubmission(
  body: RiskAssessmentInput,
  criteria: RiskCriteria | null,
) {
  if (!criteria || !body.workScope || !body.trigger || !body.hazards.length)
    throw new HttpError(
      400,
      "확인된 기준·작업 범위·시행 계기·위험행이 필요합니다.",
    );
  if (body.method === "checklist" && criteria.method === "checklist")
    validateChecklistCoverage(body, criteria);
  const results = riskResults(body, criteria);
  for (const [i, h] of body.hazards.entries()) {
    if (
      results[i].incomplete ||
      (body.method !== "checklist" && !h.currentControls)
    )
      throw new HttpError(
        400,
        body.method === "checklist"
          ? `항목 ${i + 1}의 연결·작업·응답·판단 근거를 확인하세요. 해당없음도 사유가 필요합니다.`
          : body.method === "narrative"
            ? `위험행 ${i + 1}의 핵심 서술·작업·추가조치 판단·근거를 확인하세요. 추가 판단 필요는 미선택과 다릅니다.`
          : `위험행 ${i + 1}의 작업·상황·피해·현재조치·평가값·근거를 확인하세요.`,
      );
    if ("additionalPlanDecision" in h && h.additionalPlanDecision === "none_proposed" && h.plans.some((p) => p.action.trim()))
      throw new HttpError(400, `위험행 ${i + 1}은 추가계획 미제안으로 선택했지만 내용 있는 계획이 있습니다. 판단 또는 계획을 확인하세요.`);
    if (
      (results[i].criterionAcceptable === false ||
        ("outcome" in h && h.outcome === "noncompliant") ||
        ("additionalPlanDecision" in h && h.additionalPlanDecision === "planned")) &&
      !h.plans.some(
        (p) => p.action && p.ownerNote && p.due && p.controlType !== "미정",
      )
    )
      throw new HttpError(
        400,
        `위험행 ${i + 1}에 조치 내용·담당 메모·예정일·통제유형이 있는 계획이 필요합니다. 실제 이행을 뜻하지 않습니다.`,
      );
  }
}
export function fixedRiskSubmission(row: RiskAssessmentRecord) {
  const s = row.submission;
  if (
    !s ||
    !row.submission_hash ||
    riskHash(s) !== row.submission_hash ||
    s.id !== row.id ||
    s.siteId !== row.site_id ||
    s.author.id !== row.author_id ||
    s.version > row.version ||
    JSON.stringify(s.body) !== JSON.stringify(row.body) ||
    JSON.stringify(s.criteria) !== JSON.stringify(row.criteria_snapshot) ||
    JSON.stringify(s.results) !== JSON.stringify(row.results)
  )
    throw new HttpError(409, "제출 보관본이 일치하지 않습니다.");
  return s;
}
export function registerRiskReview(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  const base = "/api/sites/:siteId/risk-assessments";
  const read = (req: Request) =>
    assessmentRecord(
      assessment(db, String(req.params.siteId), String(req.params.id)),
    );
  function author(req: Request) {
    access(req, true);
    if (read(req).author_id !== req.session.userId)
      throw new HttpError(403, "작성 계정만 제출할 수 있습니다.");
  }
  function reviewer(req: Request) {
    access(req, true, true);
    if (read(req).author_id === req.session.userId && !soleManager(db, String(req.params.siteId), req.session.userId!))
      throw new HttpError(
        403,
        "작성 계정과 다른 현장 관리자가 문서를 검토해야 합니다. 실제 위험 허용 판단이 아닙니다.",
      );
  }
  function eligible(site: string, id: string) {
    if (
      !canWriteSite(db, site, id)
    )
      throw new HttpError(400, "현재 현장의 작성 가능한 계정을 선택하세요.");
  }
  function nextDraft(
    req: Request,
    old: RiskAssessmentRecord,
    authorId: string,
    why: string,
  ) {
    if (old.successor_id)
      throw new HttpError(
        409,
        "이미 후속 초안이 있습니다. 기존 후속 문서를 조회하세요.",
      );
    eligible(old.site_id, authorId);
    const id = randomUUID(),
      at = new Date().toISOString();
    db.prepare(
      "INSERT INTO risk_assessments(id,site_id,author_id,version,body,criteria_id,criteria_snapshot,criteria_hash,created_at,updated_at,parent_id) VALUES(?,?,?,1,?,?,?,?,?,?,?)",
    ).run(
      id,
      old.site_id,
      authorId,
      JSON.stringify(old.body),
      old.criteria_id,
      old.criteria_snapshot ? JSON.stringify(old.criteria_snapshot) : null,
      old.criteria_hash,
      at,
      at,
      old.id,
    );
    db.prepare("UPDATE risk_assessments SET successor_id=? WHERE id=?").run(
      id,
      old.id,
    );
    const row = assessmentRecord(assessment(db, old.site_id, id));
    riskEvent(
      db,
      req,
      "assessment",
      row,
      "correction_created",
      `이전 문서 ${old.id}; 원 작성자 ${old.author_id}; 새 작성자 ${authorId}; ${why}`,
    );
    return row;
  }
  // Concrete manager-only picker; no email or global account directory.
  app.get("/api/sites/:siteId/risk-authors", (req, res) => {
    access(req, false, true);
    const q = companyPage.parse(req.query),
      rows = db
        .prepare(
          "SELECT u.id,u.name,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.site_id=? AND m.role IN ('manager','editor') ORDER BY u.name,u.id LIMIT 51 OFFSET ?",
        )
        .all(String(req.params.siteId), q.offset);
    res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  app.post(base + "/:id/submit", (req, res) => {
    author(req);
    const v = z
      .object({ version: revision, reason, confirmRecordOnly: z.literal(true) })
      .strict()
      .parse(req.body);
    mutate(
      req,
      res,
      `risk:submit:${req.params.siteId}:${req.params.id}`,
      v,
      () => {
        const old = read(req);
        if (old.status !== "draft" || old.version !== v.version)
          throw new HttpError(409, "초안 상태/버전이 바뀌었습니다.");
        validateRiskSubmission(old.body, old.criteria_snapshot?.body ?? null);
        const at = new Date().toISOString(),
          s: RiskSubmission = {
            id: old.id,
            siteId: old.site_id,
            author: account(db, old.author_id),
            version: old.version + 1,
            body: old.body,
            criteria: old.criteria_snapshot!,
            results: old.results,
            at,
          };
        db.prepare(
          "UPDATE risk_assessments SET status='submitted',version=version+1,submission=?,submission_hash=?,updated_at=? WHERE id=?",
        ).run(JSON.stringify(s), riskHash(s), at, old.id);
        let row = read(req);
        riskEvent(db, req, "assessment", row, "submitted", v.reason);
        if (soleManager(db, old.site_id, req.session.userId!)) {
          const now = new Date().toISOString(),
            d: RiskDecision = {
              kind: "accepted",
              reason: SOLE_MANAGER_NOTE,
              actor: account(db, req.session.userId!),
              at: now,
              submissionHash: row.submission_hash!,
              selfProcessed: true,
            };
          db.prepare(
            "UPDATE risk_assessments SET status='accepted',version=version+1,decision=?,updated_at=? WHERE id=?",
          ).run(JSON.stringify(d), now, old.id);
          row = read(req);
          riskEvent(db, req, "assessment", row, "document_accepted", SOLE_MANAGER_NOTE);
        }
        return row;
      },
      () => {
        author(req);
      },
    );
  });
  app.post(base + "/:id/review", (req, res) => {
    reviewer(req);
    const v = z
      .discriminatedUnion("decision", [
        z
          .object({
            version: revision,
            reason,
            decision: z.literal("accepted"),
            confirmRecordOnly: z.literal(true),
          })
          .strict(),
        z
          .object({
            version: revision,
            reason,
            decision: z.literal("returned"),
            authorId: z.uuid(),
            confirmRecordOnly: z.literal(true),
          })
          .strict(),
      ])
      .parse(req.body);
    mutate(
      req,
      res,
      `risk:review:${req.params.siteId}:${req.params.id}`,
      v,
      () => {
        const old = read(req);
        if (old.status !== "submitted" || old.version !== v.version)
          throw new HttpError(409, "제출 상태/버전이 바뀌었습니다.");
        fixedRiskSubmission(old);
        const at = new Date().toISOString(),
          d: RiskDecision = {
            kind: v.decision,
            reason: v.reason,
            actor: account(db, req.session.userId!),
            at,
            submissionHash: old.submission_hash!,
          };
        db.prepare(
          "UPDATE risk_assessments SET status=?,version=version+1,decision=?,updated_at=? WHERE id=?",
        ).run(v.decision, JSON.stringify(d), at, old.id);
        const next =
            v.decision === "returned"
              ? nextDraft(req, old, v.authorId, v.reason)
              : null,
          row = read(req);
        riskEvent(
          db,
          req,
          "assessment",
          row,
          "document_" + v.decision,
          v.reason,
        );
        return { record: row, nextDraft: next };
      },
      () => {
        reviewer(req);
      },
    );
  });
  app.post(base + "/:id/revise", (req, res) => {
    access(req, true, true);
    const v = z
      .object({ version: revision, reason, authorId: z.uuid() })
      .strict()
      .parse(req.body);
    mutate(
      req,
      res,
      `risk:revise:${req.params.siteId}:${req.params.id}`,
      v,
      () => {
        const old = read(req);
        if (old.status !== "accepted" || old.version !== v.version)
          throw new HttpError(409, "문서 수락 상태/버전이 바뀌었습니다.");
        fixedRiskSubmission(old);
        const next = nextDraft(req, old, v.authorId, v.reason);
        db.prepare(
          "UPDATE risk_assessments SET version=version+1,updated_at=? WHERE id=?",
        ).run(new Date().toISOString(), old.id);
        const row = read(req);
        riskEvent(db, req, "assessment", row, "correction_linked", v.reason);
        return { record: row, nextDraft: next };
      },
      () => {
        access(req, true, true);
      },
    );
  });
}
