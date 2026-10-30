import { reuseProvenance } from "./risk-reuse.js";
import type { Express, Request } from "express";
import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { assessment, assessmentRecord } from "./risk-core.js";
import { fixedRiskSubmission } from "./risk-review.js";
import { riskActionRecord, type ActionRow } from "./risk-actions.js";
import {
  residualContext,
  residualRecord,
  type ResidualRow,
  type ResidualContext,
} from "./risk-residuals.js";
import { riskHash } from "./risk-model.js";
import { printRiskDocument } from "./risk-document-print.js";
export const RISK_REPORT_MAX_BYTES = 256 * 1024,
  RISK_REPORT_HTML_MAX_BYTES = 1024 * 1024;
export function assertRiskReportBounds(
  value: unknown,
  counts: { hazards: number; actions: number; residuals: number },
) {
  if (counts.hazards > 50 || counts.actions > 500 || counts.residuals > 100)
    throw new HttpError(
      400,
      "인쇄 행 한도를 초과했습니다. 일부만 생략하여 인쇄하지 않습니다.",
    );
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > RISK_REPORT_MAX_BYTES)
    throw new HttpError(
      400,
      "인쇄 자료256KiB 한도를 초과했습니다. 일부 내용을 생략하지 않습니다.",
    );
}
function buildRiskDocument(db: Db, site: string, id: string) {
  const row = assessmentRecord(assessment(db, site, id));
  if (row.status === "draft")
    throw new HttpError(
      409,
      "고정 제출본이 없는 초안입니다. 초안 인쇄는 이 경로에서 제공하지 않습니다.",
    );
  const submission = fixedRiskSubmission(row),
    siteRow = db.prepare("SELECT id,name FROM sites WHERE id=?").get(site) as {
      id: string;
      name: string;
    };
  const next = row.successor_id ? assessment(db, site, row.successor_id) : null;
  const actionRows = db
    .prepare(
      "SELECT * FROM risk_actions WHERE site_id=? AND assessment_id=? ORDER BY hazard_id,plan_index,id LIMIT 501",
    )
    .all(site, id) as ActionRow[];
  const residualRows = db
    .prepare(
      "SELECT r.* FROM risk_residuals r JOIN (SELECT hazard_id,kind,MAX(version) version FROM risk_residuals WHERE site_id=? AND assessment_id=? GROUP BY hazard_id,kind) m ON m.hazard_id=r.hazard_id AND m.kind=r.kind AND m.version=r.version WHERE r.site_id=? AND r.assessment_id=? ORDER BY r.hazard_id,r.kind,r.id LIMIT 101",
    )
    .all(site, id, site, id) as ResidualRow[];
  assertRiskReportBounds(null, {
    hazards: submission.body.hazards.length,
    actions: actionRows.length,
    residuals: residualRows.length,
  });
  const actions = actionRows.map((a) => {
    const r = riskActionRecord(db, a),
      h = submission.body.hazards.find((x) => x.id === a.hazard_id);
    if (
      !h?.plans[a.plan_index] ||
      r.source.submissionHash !== row.submission_hash
    )
      throw new HttpError(409, "조치 원천 연결이 제출본과 일치하지 않습니다.");
    return {
      id: r.id,
      hazardId: r.hazard_id,
      planIndex: r.plan_index,
      version: r.version,
      status: r.status,
      sourceHash: r.source_hash,
      assignee: r.assignee,
      due: r.due,
      report: r.report,
      verification: r.verification,
      updatedAt: r.updated_at,
    };
  });
  const contexts = new Map<string, ResidualContext>();
  const residuals = residualRows.map((r) => {
    if (!contexts.has(r.hazard_id))
      contexts.set(r.hazard_id, residualContext(db, site, id, r.hazard_id));
    const value = residualRecord(r, contexts.get(r.hazard_id)!);
    return {
      id: value.id,
      hazardId: value.hazard_id,
      kind: value.kind,
      version: value.version,
      snapshotHash: value.snapshot_hash,
      stale: value.stale,
      ...(value.snapshot.method === "checklist" ? {method:"checklist" as const,checklistItemId:value.snapshot.checklistItemId,outcome:value.snapshot.outcome}
        : value.snapshot.method === "narrative" ? {method:"narrative" as const,answers:value.snapshot.answers,additionalPlanDecision:value.snapshot.additionalPlanDecision,followupNotes:value.snapshot.followupNotes}
        : value.snapshot.method === "three_level"
        ? { method: "three_level" as const, levelId: value.snapshot.levelId }
        : { method: "product" as const, likelihood: value.snapshot.likelihood, severity: value.snapshot.severity }),
      result: value.snapshot.result,
      basis: value.snapshot.basis,
      claimedLocalDate: value.snapshot.claimedLocalDate,
      actor: value.snapshot.actor,
      recordedAt: value.snapshot.recordedAt,
      reason: value.snapshot.reason,
      contextFingerprint: value.snapshot.contextFingerprint,
      actionRefs: value.snapshot.context.actions.map((a) => ({
        id: a.actionId,
        planIndex: a.planIndex,
        version: a.version,
        status: a.status,
        reportHash: a.reportHash,
        verificationHash: a.verificationHash,
      })),
    };
  });
  const totalResiduals = (
    db
      .prepare(
        "SELECT COUNT(*) n FROM risk_residuals WHERE site_id=? AND assessment_id=?",
      )
      .get(site, id) as { n: number }
  ).n;
  const facts = {
    site: siteRow,
    document: {
      id: row.id,
      currentVersion: row.version,
      status: row.status,
      parentId: row.parent_id,
      successorId: next?.id ?? null,
      successorStatus: next?.status ?? null,
      submissionHash: row.submission_hash,
      decision: row.decision,
    },
    submission,
    reuseSource: reuseProvenance(db, site, id),
    actions,
    residuals,
    counts: {
      hazards: submission.body.hazards.length,
      plans: submission.body.hazards.reduce((n, h) => n + h.plans.length, 0),
      actions: actions.length,
      latestResiduals: residuals.length,
      allResidualHistoryRecords: totalResiduals,
    },
  };
  assertRiskReportBounds(facts, {
    hazards: facts.counts.hazards,
    actions: actions.length,
    residuals: residuals.length,
  });
  return {
    ...facts,
    fingerprint: riskHash(facts),
    generatedAt: new Date().toISOString(),
  };
}
export type RiskDocumentReport = ReturnType<typeof buildRiskDocument>;
export function readRiskDocument(
  db: Db,
  site: string,
  id: string,
  authorize: () => void,
) {
  db.exec("BEGIN DEFERRED");
  try {
    authorize();
    const report = buildRiskDocument(db, site, id);
    db.exec("COMMIT");
    return report;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function registerRiskDocumentReports(
  app: Express,
  db: Db,
  { access }: SiteOperations,
) {
  const base = "/api/sites/:siteId/risk-assessments/:id";
  const read = (req: Request) =>
    readRiskDocument(
      db,
      String(req.params.siteId),
      String(req.params.id),
      () => {
        access(req);
      },
    );
  app.get(base + "/print-context", (req, res) => {
    access(req);
    z.object({}).strict().parse(req.query);
    const r = read(req);
    res.json({
      fingerprint: r.fingerprint,
      generatedAt: r.generatedAt,
      document: r.document,
      counts: r.counts,
    });
  });
  app.get(base + "/print", (req, res) => {
    access(req);
    const q = z
        .object({ expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
        .strict()
        .parse(req.query),
      r = read(req);
    if (r.fingerprint !== q.expectedFingerprint)
      throw new HttpError(
        409,
        "인쇄 준비 후 원문 상태/현재 조치/재평가/표시 정보가 바뀌었습니다. 다시 준비하세요.",
      );
    const html = printRiskDocument(r);
    if (Buffer.byteLength(html, "utf8") > RISK_REPORT_HTML_MAX_BYTES)
      throw new HttpError(
        400,
        "인쇄 HTML1MiB 한도를 초과했습니다. 일부 내용 생략 없이 중단합니다.",
      );
    res.type("html").send(html);
  });
}
