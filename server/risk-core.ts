import type { Express, Request } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { revision } from "./validation.js";
import { account } from "./inspection-model.js";
import { companyPage } from "./companies.js";
import { riskHash } from "./risk-model.js";
import {
  methodAssessmentInput as riskAssessmentInput,
  methodCriteriaInput as riskCriteriaInput,
  methodResults as riskResults,
  validateMethodCriteria as validateRiskCriteria,
  clearMethodSelections,
  type MethodCriteria as RiskCriteria,
  type MethodAssessment as RiskAssessmentInput,
} from "./risk-methods.js";
type CriteriaRow = {
  id: string;
  site_id: string;
  parent_id: string | null;
  version: number;
  status: "draft" | "confirmed";
  body: string;
  confirmed_snapshot: string | null;
  confirmed_hash: string | null;
  created_at: string;
  updated_at: string;
};
export type AssessmentRow = {
  status: "draft" | "submitted" | "accepted" | "returned";
  parent_id: string | null;
  successor_id: string | null;
  submission: string | null;
  submission_hash: string | null;
  decision: string | null;
  id: string;
  site_id: string;
  author_id: string;
  version: number;
  body: string;
  criteria_id: string | null;
  criteria_snapshot: string | null;
  criteria_hash: string | null;
  created_at: string;
  updated_at: string;
};
export type CriteriaSnapshot = {
  id: string;
  siteId: string;
  version: number;
  body: RiskCriteria;
  actor: { id: string; name: string };
  at: string;
};
const reason = z.string().trim().min(1).max(1000);
function criterion(db: Db, site: string, id: string) {
  const row = db
    .prepare("SELECT * FROM risk_criteria WHERE site_id=? AND id=?")
    .get(site, id) as CriteriaRow | undefined;
  if (!row) throw new HttpError(404, "기준을 찾을 수 없습니다.");
  return row;
}
function criteriaSnapshot(row: CriteriaRow): CriteriaSnapshot {
  if (row.status !== "confirmed" || !row.confirmed_snapshot)
    throw new HttpError(409, "사람이 확인한 기준 버전이 필요합니다.");
  const value = JSON.parse(row.confirmed_snapshot) as CriteriaSnapshot;
  if (
    riskHash(value) !== row.confirmed_hash ||
    value.id !== row.id ||
    value.siteId !== row.site_id ||
    value.version !== row.version
  )
    throw new HttpError(409, "기준 보관본이 일치하지 않습니다.");
  validateRiskCriteria(riskCriteriaInput.parse(value.body));
  return value;
}
function criteriaRecord(row: CriteriaRow) {
  return {
    ...row,
    body: riskCriteriaInput.parse(JSON.parse(row.body)),
    confirmed_snapshot: row.confirmed_snapshot ? criteriaSnapshot(row) : null,
  };
}
export function assessment(db: Db, site: string, id: string) {
  const row = db
    .prepare("SELECT * FROM risk_assessments WHERE site_id=? AND id=?")
    .get(site, id) as AssessmentRow | undefined;
  if (!row) throw new HttpError(404, "평가 초안을 찾을 수 없습니다.");
  return row;
}
export function assessmentRecord(row: AssessmentRow) {
  const body = riskAssessmentInput.parse(JSON.parse(row.body)),
    source = row.criteria_snapshot
      ? (JSON.parse(row.criteria_snapshot) as CriteriaSnapshot)
      : null;
  if (
    source &&
    (riskHash(source) !== row.criteria_hash ||
      source.siteId !== row.site_id ||
      source.id !== row.criteria_id)
  )
    throw new HttpError(409, "선택 기준 보관본이 일치하지 않습니다.");
  return {
    ...row,
    body,
    criteria_snapshot: source,
    results: riskResults(body, source?.body ?? null),
    submission: row.submission
      ? (JSON.parse(row.submission) as RiskSubmission)
      : null,
    decision: row.decision ? (JSON.parse(row.decision) as RiskDecision) : null,
  };
}
export type RiskSubmission = {
  id: string;
  siteId: string;
  author: { id: string; name: string };
  version: number;
  body: RiskAssessmentInput;
  criteria: CriteriaSnapshot;
  results: ReturnType<typeof riskResults>;
  at: string;
};
export type RiskDecision = {
  kind: "accepted" | "returned";
  reason: string;
  actor: { id: string; name: string };
  at: string;
  submissionHash: string;
};
export type RiskCriteriaRecord = ReturnType<typeof criteriaRecord>;
export type RiskAssessmentRecord = ReturnType<typeof assessmentRecord>;
export function riskEvent(
  db: Db,
  req: Request,
  kind: "criteria" | "assessment",
  row: RiskCriteriaRecord | RiskAssessmentRecord,
  action: string,
  why: string,
) {
  const a = account(db, req.session.userId!);
  db.prepare(
    "INSERT INTO risk_events(site_id,kind,record_id,version,event,reason,actor_id,actor_name,at,snapshot) VALUES(?,?,?,?,?,?,?,?,?,?)",
  ).run(
    row.site_id,
    kind,
    row.id,
    row.version,
    action,
    why,
    a.id,
    a.name,
    new Date().toISOString(),
    JSON.stringify(row),
  );
  audit(db, a.id, row.site_id, `risk.${kind}.${action}`, row.id);
}

export function registerRiskCore(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  const base = "/api/sites/:siteId/risk-criteria",
    drafts = "/api/sites/:siteId/risk-assessments";
  const event = (
    req: Request,
    kind: "criteria" | "assessment",
    row: RiskCriteriaRecord | RiskAssessmentRecord,
    action: string,
    why: string,
  ) => riskEvent(db, req, kind, row, action, why);
  function owner(req: Request) {
    access(req, true);
    const row = assessment(
      db,
      String(req.params.siteId),
      String(req.params.id),
    );
    if (row.author_id !== req.session.userId)
      throw new HttpError(403, "작성 계정만 초안을 변경할 수 있습니다.");
    return row;
  }
  for (const [path, kind] of [
    [base, "criteria"],
    [drafts, "assessment"],
  ] as const) {
    app.get(path, (req, res) => {
      const role = access(req),
        q = (
          kind === "criteria"
            ? companyPage.extend({ status: z.literal("confirmed").optional() })
            : companyPage.extend({
                status: z
                  .enum(["draft", "submitted", "accepted", "returned"])
                  .optional(),
              })
        )
          .extend({
            method: z.enum(["product", "three_level", "checklist", "narrative"]).optional(),
          })
          .parse(req.query),
        site = String(req.params.siteId);
      const rows =
        kind === "criteria"
          ? db
              .prepare(
                "SELECT * FROM risk_criteria WHERE site_id=? AND (?='manager' OR status='confirmed') AND (? IS NULL OR status=?) AND (? IS NULL OR json_extract(body,'$.method')=?) ORDER BY created_at DESC,id LIMIT 51 OFFSET ?",
              )
              .all(
                site,
                role,
                "status" in q && q.status === "confirmed" ? "confirmed" : null,
                "status" in q && q.status === "confirmed" ? "confirmed" : null,
                q.method ?? null,
                q.method ?? null,
                q.offset,
              )
          : db
              .prepare(
                "SELECT * FROM risk_assessments WHERE site_id=? AND (? IS NULL OR status=?) AND (? IS NULL OR json_extract(body,'$.method')=?) ORDER BY updated_at DESC,id LIMIT 51 OFFSET ?",
              )
              .all(
                site,
                q.status ?? null,
                q.status ?? null,
                q.method ?? null,
                q.method ?? null,
                q.offset,
              );
      res.json({
        items: rows
          .slice(0, 50)
          .map((r) =>
            kind === "criteria"
              ? criteriaRecord(r as CriteriaRow)
              : assessmentRecord(r as AssessmentRow),
          ),
        hasMore: rows.length > 50,
      });
    });
    app.get(path + "/:id", (req, res) => {
      const role = access(req),
        site = String(req.params.siteId),
        id = String(req.params.id);
      if (kind === "criteria") {
        const row = criterion(db, site, id);
        if (row.status === "draft" && role !== "manager")
          throw new HttpError(404, "기준을 찾을 수 없습니다.");
        res.json(criteriaRecord(row));
      } else res.json(assessmentRecord(assessment(db, site, id)));
    });
    app.get(path + "/:id/events", (req, res) => {
      const role = access(req),
        site = String(req.params.siteId),
        id = String(req.params.id);
      if (kind === "criteria") {
        if (criterion(db, site, id).status === "draft" && role !== "manager")
          throw new HttpError(404, "기준을 찾을 수 없습니다.");
      } else assessment(db, site, id);
      const q = companyPage.parse(req.query),
        rows = db
          .prepare(
            "SELECT * FROM risk_events WHERE site_id=? AND kind=? AND record_id=? ORDER BY version LIMIT 51 OFFSET ?",
          )
          .all(site, kind, id, q.offset);
      res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50 });
    });
  }
  app.post(base, (req, res) => {
    access(req, true, true);
    const v = riskCriteriaInput.parse(req.body),
      site = String(req.params.siteId);
    mutate(
      req,
      res,
      `risk:criteria:create:${site}`,
      v,
      () => {
        const id = randomUUID(),
          at = new Date().toISOString();
        db.prepare(
          "INSERT INTO risk_criteria VALUES(?,?,NULL,1,'draft',?,NULL,NULL,?,?)",
        ).run(id, site, JSON.stringify(v), at, at);
        const row = criteriaRecord(criterion(db, site, id));
        event(req, "criteria", row, "created", "기준 초안 생성");
        return row;
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.put(base + "/:id", (req, res) => {
    access(req, true, true);
    const v = z
        .object({ version: revision, body: riskCriteriaInput, reason })
        .strict()
        .parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `risk:criteria:edit:${site}:${id}`,
      v,
      () => {
        const old = criterion(db, site, id);
        if (old.version !== v.version || old.status !== "draft")
          throw new HttpError(409, "기준 상태/버전이 바뀌었습니다.");
        if (
          riskCriteriaInput.parse(JSON.parse(old.body)).method !== v.body.method
        )
          throw new HttpError(
            400,
            "기준 방법은 변경할 수 없습니다. 별도 기준을 작성하세요.",
          );
        db.prepare(
          "UPDATE risk_criteria SET body=?,version=version+1,updated_at=? WHERE id=?",
        ).run(JSON.stringify(v.body), new Date().toISOString(), id);
        const row = criteriaRecord(criterion(db, site, id));
        event(req, "criteria", row, "edited", v.reason);
        return row;
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.post(base + "/:id/confirm", (req, res) => {
    access(req, true, true);
    const v = z
        .object({
          version: revision,
          reason,
          confirmHumanCriteria: z.literal(true),
        })
        .strict()
        .parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `risk:criteria:confirm:${site}:${id}`,
      v,
      () => {
        const old = criterion(db, site, id);
        if (old.version !== v.version || old.status !== "draft")
          throw new HttpError(409, "기준 상태/버전이 바뀌었습니다.");
        const body = riskCriteriaInput.parse(JSON.parse(old.body));
        validateRiskCriteria(body);
        const at = new Date().toISOString(),
          snapshot: CriteriaSnapshot = {
            id,
            siteId: site,
            version: old.version + 1,
            body,
            actor: account(db, req.session.userId!),
            at,
          };
        db.prepare(
          "UPDATE risk_criteria SET version=version+1,status='confirmed',confirmed_snapshot=?,confirmed_hash=?,updated_at=? WHERE id=?",
        ).run(JSON.stringify(snapshot), riskHash(snapshot), at, id);
        const row = criteriaRecord(criterion(db, site, id));
        event(req, "criteria", row, "confirmed", v.reason);
        return row;
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.post(base + "/:id/revise", (req, res) => {
    access(req, true, true);
    const v = z.object({ version: revision, reason }).strict().parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `risk:criteria:revise:${site}:${id}`,
      v,
      () => {
        const old = criterion(db, site, id);
        criteriaSnapshot(old);
        if (
          old.version !== v.version ||
          db.prepare("SELECT 1 FROM risk_criteria WHERE parent_id=?").get(id)
        )
          throw new HttpError(
            409,
            "이미 후속 초안이 있거나 버전이 바뀌었습니다.",
          );
        const next = randomUUID(),
          at = new Date().toISOString();
        db.prepare(
          "INSERT INTO risk_criteria VALUES(?,?,?,1,'draft',?,NULL,NULL,?,?)",
        ).run(next, site, id, old.body, at, at);
        const row = criteriaRecord(criterion(db, site, next));
        event(req, "criteria", row, "revision_created", v.reason);
        return row;
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.post(drafts, (req, res) => {
    access(req, true);
    const v = z
        .object({ body: riskAssessmentInput, criteriaId: z.uuid().nullable() })
        .strict()
        .parse(req.body),
      site = String(req.params.siteId);
    mutate(
      req,
      res,
      `risk:assessment:create:${site}`,
      v,
      () => {
        const source = v.criteriaId
          ? criteriaSnapshot(criterion(db, site, v.criteriaId))
          : null;
        riskResults(v.body, source?.body ?? null);
        const id = randomUUID(),
          at = new Date().toISOString();
        db.prepare(
          "INSERT INTO risk_assessments(id,site_id,author_id,version,body,criteria_id,criteria_snapshot,criteria_hash,created_at,updated_at) VALUES(?,?,?,1,?,?,?,?,?,?)",
        ).run(
          id,
          site,
          req.session.userId!,
          JSON.stringify(v.body),
          v.criteriaId,
          source ? JSON.stringify(source) : null,
          source ? riskHash(source) : null,
          at,
          at,
        );
        const row = assessmentRecord(assessment(db, site, id));
        event(req, "assessment", row, "created", "평가 초안 생성");
        return row;
      },
      () => {
        access(req, true);
      },
    );
  });
  app.put(drafts + "/:id", (req, res) => {
    owner(req);
    const v = z
        .object({ version: revision, body: riskAssessmentInput, reason })
        .strict()
        .parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `risk:assessment:edit:${site}:${id}`,
      v,
      () => {
        const old = assessmentRecord(assessment(db, site, id));
        if (old.version !== v.version || old.status !== "draft")
          throw new HttpError(409, "평가 버전이 바뀌었습니다.");
        if (v.body.method !== old.body.method)
          throw new HttpError(
            400,
            "평가 방법은 변경할 수 없습니다. 별도 평가를 작성하세요.",
          );
        riskResults(v.body, old.criteria_snapshot?.body ?? null);
        db.prepare(
          "UPDATE risk_assessments SET body=?,version=version+1,updated_at=? WHERE id=?",
        ).run(JSON.stringify(v.body), new Date().toISOString(), id);
        const row = assessmentRecord(assessment(db, site, id));
        event(req, "assessment", row, "edited", v.reason);
        return row;
      },
      () => {
        owner(req);
      },
    );
  });
  app.post(drafts + "/:id/criteria", (req, res) => {
    owner(req);
    const v = z
        .object({
          version: revision,
          criteriaId: z.uuid().nullable(),
          confirmResetValues: z.literal(true),
          reason,
        })
        .strict()
        .parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `risk:assessment:criteria:${site}:${id}`,
      v,
      () => {
        const old = assessmentRecord(assessment(db, site, id));
        if (old.version !== v.version || old.status !== "draft")
          throw new HttpError(409, "평가 버전이 바뀌었습니다.");
        const source = v.criteriaId
          ? criteriaSnapshot(criterion(db, site, v.criteriaId))
          : null;
        if (source && source.body.method !== old.body.method)
          throw new HttpError(
            400,
            "방법이 다른 기준으로 바꿀 수 없습니다. 별도 평가를 작성하세요.",
          );
        const body = clearMethodSelections(old.body);
        db.prepare(
          "UPDATE risk_assessments SET body=?,criteria_id=?,criteria_snapshot=?,criteria_hash=?,version=version+1,updated_at=? WHERE id=?",
        ).run(
          JSON.stringify(body),
          v.criteriaId,
          source ? JSON.stringify(source) : null,
          source ? riskHash(source) : null,
          new Date().toISOString(),
          id,
        );
        const row = assessmentRecord(assessment(db, site, id));
        event(req, "assessment", row, "criteria_replaced", v.reason);
        return row;
      },
      () => {
        owner(req);
      },
    );
  });
}
