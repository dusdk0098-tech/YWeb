import type { Express, Request } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { date, revision } from "./validation.js";
import { companyPage } from "./companies.js";
import { account } from "./inspection-model.js";
import {
  assessment,
  assessmentRecord,
  type RiskSubmission,
} from "./risk-core.js";
import { fixedRiskSubmission } from "./risk-review.js";
import { riskHash } from "./risk-model.js";
type Actor = { id: string; name: string };
export type RiskActionSource = {
  assessmentId: string;
  siteId: string;
  submissionHash: string;
  submissionVersion: number;
  assessmentTitle: string;
  assessmentDate: string;
  hazardId: string;
  planIndex: number;
  hazard: RiskSubmission["body"]["hazards"][number];
  criteria: RiskSubmission["criteria"];
  createdBy: Actor;
  createdAt: string;
};
type Report = {
  text: string;
  claimedLocalDate: string;
  actor: Actor;
  recordedAt: string;
};
type Verification = {
  note: string;
  claimedLocalDate: string;
  actor: Actor;
  recordedAt: string;
  reportHash: string;
};
export type ActionRow = {
  id: string;
  site_id: string;
  assessment_id: string;
  hazard_id: string;
  plan_index: number;
  source: string;
  source_hash: string;
  status: "assigned" | "reported" | "verified";
  assignee_id: string;
  due: string;
  version: number;
  report: string | null;
  verification: string | null;
  created_at: string;
  updated_at: string;
};
function actionRow(db: Db, site: string, id: string) {
  const row = db
    .prepare("SELECT * FROM risk_actions WHERE site_id=? AND id=?")
    .get(site, id) as ActionRow | undefined;
  if (!row) throw new HttpError(404, "이 현장의 조치 기록을 찾을 수 없습니다.");
  return row;
}
export function riskActionRecord(db: Db, row: ActionRow) {
  const source = JSON.parse(row.source) as RiskActionSource;
  if (
    riskHash(source) !== row.source_hash ||
    source.siteId !== row.site_id ||
    source.assessmentId !== row.assessment_id ||
    source.hazardId !== row.hazard_id ||
    source.planIndex !== row.plan_index
  )
    throw new HttpError(409, "원 조치 출처가 일치하지 않습니다.");
  const doc = assessment(db, row.site_id, row.assessment_id),
    next = doc.successor_id
      ? assessment(db, row.site_id, doc.successor_id)
      : null;
  return {
    ...row,
    source,
    report: row.report ? (JSON.parse(row.report) as Report) : null,
    verification: row.verification
      ? (JSON.parse(row.verification) as Verification)
      : null,
    sourceDocument: {
      id: doc.id,
      version: doc.version,
      status: doc.status,
      successorId: next?.id ?? null,
      successorStatus: next?.status ?? null,
    },
    assignee: account(db, row.assignee_id),
  };
}
export type RiskAction = ReturnType<typeof riskActionRecord>;
const reason = z.string().trim().min(1).max(1000),
  prose = z.string().trim().min(1).max(5000);
export function registerRiskActions(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  const base = "/api/sites/:siteId/risk-actions";
  const read = (req: Request) =>
    actionRow(db, String(req.params.siteId), String(req.params.id));
  function manager(req: Request) {
    access(req, true, true);
    read(req);
  }
  function assigned(req: Request) {
    access(req, true);
    if (read(req).assignee_id !== req.session.userId)
      throw new HttpError(
        403,
        "현재 배정 계정만 이행 보고를 기록할 수 있습니다.",
      );
  }
  function verifier(req: Request) {
    access(req, true, true);
    const old = read(req),
      report = old.report ? (JSON.parse(old.report) as Report) : null;
    if (
      old.assignee_id === req.session.userId ||
      report?.actor.id === req.session.userId
    )
      throw new HttpError(
        403,
        "배정/보고 계정과 다른 현장 관리자가 확인을 기록해야 합니다.",
      );
  }
  function eligible(site: string, id: string) {
    if (
      !db
        .prepare(
          "SELECT 1 FROM memberships WHERE site_id=? AND user_id=? AND role IN ('manager','editor')",
        )
        .get(site, id)
    )
      throw new HttpError(400, "현재 작성 가능한 현장 계정만 배정하세요.");
  }
  function event(req: Request, row: RiskAction, kind: string, why: string) {
    const a = account(db, req.session.userId!);
    db.prepare(
      "INSERT INTO risk_action_events(action_id,version,event,reason,actor_id,actor_name,at,snapshot) VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      row.id,
      row.version,
      kind,
      why,
      a.id,
      a.name,
      new Date().toISOString(),
      JSON.stringify(row),
    );
    audit(db, a.id, row.site_id, "risk.action." + kind, row.id);
  }
  app.get(base, (req, res) => {
    access(req);
    const q = companyPage
        .extend({
          assessmentId: z.uuid().optional(),
          status: z.enum(["assigned", "reported", "verified"]).optional(),
        })
        .parse(req.query),
      rows = db
        .prepare(
          "SELECT * FROM risk_actions WHERE site_id=? AND (? IS NULL OR assessment_id=?) AND (? IS NULL OR status=?) ORDER BY due,id LIMIT 51 OFFSET ?",
        )
        .all(
          String(req.params.siteId),
          q.assessmentId ?? null,
          q.assessmentId ?? null,
          q.status ?? null,
          q.status ?? null,
          q.offset,
        ) as ActionRow[];
    res.json({
      items: rows.slice(0, 50).map((r) => riskActionRecord(db, r)),
      hasMore: rows.length > 50,
    });
  });
  app.get(base + "/:id", (req, res) => {
    access(req);
    res.json(riskActionRecord(db, read(req)));
  });
  app.get(base + "/:id/events", (req, res) => {
    access(req);
    const old = read(req),
      q = companyPage.parse(req.query),
      rows = db
        .prepare(
          "SELECT * FROM risk_action_events WHERE action_id=? ORDER BY version LIMIT 51 OFFSET ?",
        )
        .all(old.id, q.offset);
    res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  app.post("/api/sites/:siteId/risk-assessments/:id/actions", (req, res) => {
    access(req, true, true);
    const v = z
        .object({
          version: revision,
          hazardId: z.uuid(),
          planIndex: z.number().int().min(0).max(9),
          assigneeId: z.uuid(),
          due: date,
          reason,
          confirmManualTracking: z.literal(true),
        })
        .strict()
        .parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `risk:action:create:${site}:${id}`,
      v,
      () => {
        const doc = assessmentRecord(assessment(db, site, id));
        if (
          doc.status !== "accepted" ||
          doc.version !== v.version ||
          doc.successor_id
        )
          throw new HttpError(
            409,
            "후속 문서가 없는 수락본의 현재 버전을 선택하세요. 기존 조치는 삭제되지 않습니다.",
          );
        const submission = fixedRiskSubmission(doc),
          hazard = submission.body.hazards.find((h) => h.id === v.hazardId),
          plan = hazard?.plans[v.planIndex];
        if (!hazard || !plan?.action.trim())
          throw new HttpError(
            400,
            "원 제출본의 내용 있는 저감 계획을 선택하세요.",
          );
        eligible(site, v.assigneeId);
        if (
          db
            .prepare(
              "SELECT 1 FROM risk_actions WHERE assessment_id=? AND hazard_id=? AND plan_index=?",
            )
            .get(id, v.hazardId, v.planIndex)
        )
          throw new HttpError(
            409,
            "이 원 계획의 조치 기록이 이미 있습니다. 기존 기록을 조회하세요.",
          );
        const aid = randomUUID(),
          at = new Date().toISOString(),
          source: RiskActionSource = {
            assessmentId: id,
            siteId: site,
            submissionHash: doc.submission_hash!,
            submissionVersion: submission.version,
            assessmentTitle: submission.body.title,
            assessmentDate: submission.body.date,
            hazardId: hazard.id,
            planIndex: v.planIndex,
            hazard,
            criteria: submission.criteria,
            createdBy: account(db, req.session.userId!),
            createdAt: at,
          };
        db.prepare(
          "INSERT INTO risk_actions VALUES(?,?,?,?,?,?,?,'assigned',?,?,1,NULL,NULL,?,?)",
        ).run(
          aid,
          site,
          id,
          hazard.id,
          v.planIndex,
          JSON.stringify(source),
          riskHash(source),
          v.assigneeId,
          v.due,
          at,
          at,
        );
        const row = riskActionRecord(db, actionRow(db, site, aid));
        event(req, row, "created", v.reason);
        return row;
      },
      () => {
        access(req, true, true);
        assessment(db, site, id);
      },
    );
  });
  app.post(base + "/:id/assign", (req, res) => {
    manager(req);
    const v = z
      .object({ version: revision, assigneeId: z.uuid(), due: date, reason })
      .strict()
      .parse(req.body);
    mutate(
      req,
      res,
      `risk:action:assign:${req.params.siteId}:${req.params.id}`,
      v,
      () => {
        const old = read(req);
        if (old.version !== v.version || old.status === "verified")
          throw new HttpError(
            409,
            "확인 기록은 먼저 사유로 재개방하세요. 또는 현재 버전을 조회하세요.",
          );
        eligible(old.site_id, v.assigneeId);
        db.prepare(
          "UPDATE risk_actions SET status='assigned',assignee_id=?,due=?,report=NULL,verification=NULL,version=version+1,updated_at=? WHERE id=?",
        ).run(v.assigneeId, v.due, new Date().toISOString(), old.id);
        const row = riskActionRecord(db, read(req));
        event(req, row, "reassigned", v.reason);
        return row;
      },
      () => {
        manager(req);
      },
    );
  });
  app.post(base + "/:id/report", (req, res) => {
    assigned(req);
    const v = z
      .object({
        version: revision,
        text: prose,
        claimedLocalDate: date,
        reason,
        confirmHumanReport: z.literal(true),
      })
      .strict()
      .parse(req.body);
    mutate(
      req,
      res,
      `risk:action:report:${req.params.siteId}:${req.params.id}`,
      v,
      () => {
        const old = read(req);
        if (old.version !== v.version || old.status === "verified")
          throw new HttpError(
            409,
            "확인 기록은 먼저 재개방해야 하며 현재 버전이 필요합니다.",
          );
        const at = new Date().toISOString(),
          report: Report = {
            text: v.text,
            claimedLocalDate: v.claimedLocalDate,
            actor: account(db, req.session.userId!),
            recordedAt: at,
          };
        db.prepare(
          "UPDATE risk_actions SET status='reported',report=?,verification=NULL,version=version+1,updated_at=? WHERE id=?",
        ).run(JSON.stringify(report), at, old.id);
        const row = riskActionRecord(db, read(req));
        event(
          req,
          row,
          old.status === "reported" ? "report_corrected" : "reported",
          v.reason,
        );
        return row;
      },
      () => {
        assigned(req);
      },
    );
  });
  app.post(base + "/:id/verify", (req, res) => {
    verifier(req);
    const v = z
      .object({
        version: revision,
        decision: z.enum(["confirm", "reject"]),
        note: prose,
        claimedLocalDate: date,
        reason,
        confirmHumanVerification: z.literal(true),
      })
      .strict()
      .parse(req.body);
    mutate(
      req,
      res,
      `risk:action:verify:${req.params.siteId}:${req.params.id}`,
      v,
      () => {
        const old = read(req);
        if (
          old.version !== v.version ||
          old.status !== "reported" ||
          !old.report
        )
          throw new HttpError(409, "현재 보고 상태/버전을 확인하세요.");
        const report = JSON.parse(old.report) as Report;
        if (v.claimedLocalDate < report.claimedLocalDate)
          throw new HttpError(
            400,
            "현장 입력 확인일은 보고된 이행일보다 빠를 수 없습니다. 서버 UTC와 비교하지 않습니다.",
          );
        const at = new Date().toISOString(),
          verification: Verification = {
            note: v.note,
            claimedLocalDate: v.claimedLocalDate,
            actor: account(db, req.session.userId!),
            recordedAt: at,
            reportHash: riskHash(report),
          };
        if (v.decision === "confirm")
          db.prepare(
            "UPDATE risk_actions SET status='verified',verification=?,version=version+1,updated_at=? WHERE id=?",
          ).run(JSON.stringify(verification), at, old.id);
        else
          db.prepare(
            "UPDATE risk_actions SET status='assigned',report=NULL,verification=NULL,version=version+1,updated_at=? WHERE id=?",
          ).run(at, old.id);
        const row = riskActionRecord(db, read(req));
        event(
          req,
          row,
          v.decision === "confirm"
            ? "human_verification_recorded"
            : "report_rejected",
          `${v.reason}; 검토 입력일 ${v.claimedLocalDate}; 의견 ${v.note}`,
        );
        return row;
      },
      () => {
        verifier(req);
      },
    );
  });
  app.post(base + "/:id/reopen", (req, res) => {
    manager(req);
    const v = z.object({ version: revision, reason }).strict().parse(req.body);
    mutate(
      req,
      res,
      `risk:action:reopen:${req.params.siteId}:${req.params.id}`,
      v,
      () => {
        const old = read(req);
        if (old.version !== v.version || old.status !== "verified")
          throw new HttpError(409, "현재 확인 기록의 버전을 조회하세요.");
        db.prepare(
          "UPDATE risk_actions SET status='assigned',report=NULL,verification=NULL,version=version+1,updated_at=? WHERE id=?",
        ).run(new Date().toISOString(), old.id);
        const row = riskActionRecord(db, read(req));
        event(req, row, "reopened", v.reason);
        return row;
      },
      () => {
        manager(req);
      },
    );
  });
}
