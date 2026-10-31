import { checklistResidualFields,narrativeResidualFields,nonnumericResidualValues,type NonNumericResidualValues } from "./risk-nonnumeric-residuals.js";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { date } from "./validation.js";
import { account } from "./inspection-model.js";
import { companyPage } from "./companies.js";
import { assessment, assessmentRecord } from "./risk-core.js";
import { fixedRiskSubmission } from "./risk-review.js";
import {
  riskHash,
  riskResults,
  riskAssessmentInput,
  riskHazardInput,
} from "./risk-model.js";
import { methodCriteriaInput } from "./risk-methods.js";
import { threeLevelCriteriaInput } from "./risk-three-level-model.js";
export function residualContext(
  db: Db,
  site: string,
  id: string,
  hazardId: string,
) {
  const doc = assessmentRecord(assessment(db, site, id));
  if (doc.status !== "accepted")
    throw new HttpError(
      409,
      "문서 기록 수락본이 필요합니다. 안전 허용 판정이 아닙니다.",
    );
  const original = fixedRiskSubmission(doc);
  if (original.body.method !== original.criteria.body.method)
    throw new HttpError(409, "고정 평가와 기준의 방법이 일치하지 않습니다.");
  const criteriaBody = methodCriteriaInput.parse(original.criteria.body);
  const hazard = original.body.hazards.find((h) => h.id === hazardId);
  if (!hazard)
    throw new HttpError(404, "원 제출본의 위험행을 찾을 수 없습니다.");
  const plans = hazard.plans.flatMap((plan, index) =>
    plan.action.trim() ? [{ index, action: plan.action }] : [],
  );
  const rows = db
    .prepare(
      "SELECT id,plan_index,version,status,report,verification,source_hash FROM risk_actions WHERE site_id=? AND assessment_id=? AND hazard_id=? ORDER BY plan_index",
    )
    .all(site, id, hazardId) as {
    id: string;
    plan_index: number;
    version: number;
    status: string;
    report: string | null;
    verification: string | null;
    source_hash: string;
  }[];
  const actions = plans.map((p) => {
    const a = rows.find((x) => x.plan_index === p.index);
    return {
      planIndex: p.index,
      action: p.action,
      actionId: a?.id ?? null,
      version: a?.version ?? null,
      status: a?.status ?? null,
      sourceHash: a?.source_hash ?? null,
      reportHash: a?.report ? riskHash(JSON.parse(a.report)) : null,
      verificationHash: a?.verification
        ? riskHash(JSON.parse(a.verification))
        : null,
      verificationReportHash: a?.verification
        ? (JSON.parse(a.verification) as { reportHash: string }).reportHash
        : null,
    };
  });
  const facts = {
    siteId: site,
    assessmentId: id,
    hazardId,
    submissionHash: doc.submission_hash!,
    submissionVersion: original.version,
    sourceSuccessorId: doc.successor_id,
    criteria: {
      ...original.criteria,
      body: criteriaBody,
    },
    hazard,
    actions,
  };
  const ready =
    plans.length > 0 &&
    actions.every(
      (a) =>
        a.status === "verified" &&
        a.reportHash &&
        a.verificationHash &&
        a.verificationReportHash === a.reportHash,
    );
  const versions = Object.fromEntries(
    ["projected", "after_confirmation"].map((kind) => [
      kind,
      (
        db
          .prepare(
            "SELECT COALESCE(MAX(version),0) v FROM risk_residuals WHERE assessment_id=? AND hazard_id=? AND kind=?",
          )
          .get(id, hazardId, kind) as { v: number }
      ).v,
    ]),
  ) as { projected: number; after_confirmation: number };
  return {
    facts,
    fingerprint: riskHash(facts),
    versions,
    afterConfirmationReady: ready && !doc.successor_id,
    canRecord: !doc.successor_id,
    readinessNote: doc.successor_id
      ? "원 평가에 후속 문서가 있어 새 기록은 후속 수락본에서 작성하세요."
      : !plans.length
        ? "등록된 내용 있는 저감 계획이 없습니다. 조치 확인 후 입력 경로를 사용하려고 허위 계획을 만들지 말고 필요하면 평가 정정 초안을 작성하세요."
        : !ready
          ? "모든 내용 있는 원 계획에 현재 사람 확인 기록이 있는 조치가 연결되어야 합니다. 소프트웨어 절차 조건이지 법정 기준이 아닙니다."
          : "소프트웨어 절차 조건 충족. 실물 안전/법정 적합성/전체 위험 해소를 확인한 것이 아닙니다.",
  };
}
export type ResidualContext = ReturnType<typeof residualContext>;
type ResidualSnapshotBase = {
  id: string;
  siteId: string;
  assessmentId: string;
  hazardId: string;
  kind: "projected" | "after_confirmation";
  version: number;
  basis: string;
  claimedLocalDate: string;
  reason: string;
  actor: { id: string; name: string };
  recordedAt: string;
  context: ResidualContext["facts"];
  contextFingerprint: string;
};
export type ResidualSnapshot = ResidualSnapshotBase & (
  | NonNumericResidualValues
  | {
      // Legacy numeric snapshots have no method tag. Preserve their bytes.
      method?: "product";
      likelihood: number;
      severity: number;
      result: { score: number; bandLabel: string; criterionAcceptable: boolean };
    }
  | {
      method: "three_level";
      levelId: string;
      result: {
        score: null;
        selectionKind: "human_three_level";
        levelId: string;
        bandLabel: string;
        description: string;
        criterionAcceptable: boolean;
      };
    }
);
const residualCommonInput = z.object({
  kind: z.enum(["projected", "after_confirmation"]),
  expectedVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  contextFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  basis: z.string().trim().min(1).max(5000),
  claimedLocalDate: date,
  reason: z.string().trim().min(1).max(1000),
  confirmManualEvaluation: z.literal(true),
});
export const residualInput = z.union([
  // Preserve the legacy parsed key order: receipts compare serialized bytes.
  z.object({
    kind: residualCommonInput.shape.kind,
    expectedVersion: residualCommonInput.shape.expectedVersion,
    contextFingerprint: residualCommonInput.shape.contextFingerprint,
    likelihood: z.number().int().min(1).max(5),
    severity: z.number().int().min(1).max(4),
    basis: residualCommonInput.shape.basis,
    claimedLocalDate: residualCommonInput.shape.claimedLocalDate,
    reason: residualCommonInput.shape.reason,
    confirmManualEvaluation: residualCommonInput.shape.confirmManualEvaluation,
  }).strict(),
  residualCommonInput.extend(checklistResidualFields.shape).strict(),
  residualCommonInput.extend(narrativeResidualFields.shape).strict(),
  residualCommonInput.extend({
    method: z.literal("three_level"),
    levelId: z.uuid(),
  }).strict(),
]);

export type ResidualRow = {
  id: string;
  site_id: string;
  assessment_id: string;
  hazard_id: string;
  kind: ResidualSnapshot["kind"];
  version: number;
  snapshot: string;
  snapshot_hash: string;
  created_at: string;
};
export function residualRecord(row: ResidualRow, current: ResidualContext) {
  const snapshot = JSON.parse(row.snapshot) as ResidualSnapshot;
  if (
    riskHash(snapshot) !== row.snapshot_hash ||
    snapshot.id !== row.id ||
    snapshot.siteId !== row.site_id ||
    snapshot.assessmentId !== row.assessment_id ||
    snapshot.hazardId !== row.hazard_id ||
    snapshot.kind !== row.kind ||
    snapshot.version !== row.version ||
    riskHash(snapshot.context) !== snapshot.contextFingerprint
  )
    throw new HttpError(409, "재평가 기록 보관본이 일치하지 않습니다.");
  return {
    ...row,
    snapshot,
    stale: snapshot.contextFingerprint !== current.fingerprint,
    currentFingerprint: current.fingerprint,
  };
}
export type ResidualRecord = ReturnType<typeof residualRecord>;
function residualRead<T>(db: Db, read: () => T): T {
  db.exec("BEGIN DEFERRED");
  try {
    const result = read();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function registerRiskResiduals(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  const base =
    "/api/sites/:siteId/risk-assessments/:id/hazards/:hazardId/residuals";
  const context = (site: string, id: string, hazardId: string) =>
    residualContext(db, site, id, hazardId);
  app.get(base + "/context", (req, res) => {
    access(req);
    res.json(
      residualRead(db, () => {
        access(req);
        return context(
          String(req.params.siteId),
          String(req.params.id),
          String(req.params.hazardId),
        );
      }),
    );
  });
  app.get(base, (req, res) => {
    access(req);
    const q = companyPage
      .extend({ kind: z.enum(["projected", "after_confirmation"]).optional() })
      .parse(req.query);
    res.json(
      residualRead(db, () => {
        access(req);
        const site = String(req.params.siteId),
          id = String(req.params.id),
          hazard = String(req.params.hazardId),
          current = context(site, id, hazard);
        const rows = db
          .prepare(
            "SELECT * FROM risk_residuals WHERE site_id=? AND assessment_id=? AND hazard_id=? AND (? IS NULL OR kind=?) ORDER BY created_at DESC,id LIMIT 51 OFFSET ?",
          )
          .all(
            site,
            id,
            hazard,
            q.kind ?? null,
            q.kind ?? null,
            q.offset,
          ) as ResidualRow[];
        return {
          items: rows.slice(0, 50).map((r) => residualRecord(r, current)),
          hasMore: rows.length > 50,
        };
      }),
    );
  });
  app.post(base, (req, res) => {
    access(req, true, true);
    const v = residualInput.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id),
      hazardId = String(req.params.hazardId);
    mutate(
      req,
      res,
      `risk:residual:${site}:${id}:${hazardId}`,
      v,
      () => {
        const current = context(site, id, hazardId);
        if (
          !current.canRecord ||
          current.fingerprint !== v.contextFingerprint ||
          current.versions[v.kind] !== v.expectedVersion
        )
          throw new HttpError(
            409,
            "원 평가/조치 참조 또는 재평가 버전이 바뀌었습니다. 입력을 보존하고 참조를 다시 조회하세요.",
          );
        if (v.kind === "after_confirmation" && !current.afterConfirmationReady)
          throw new HttpError(409, current.readinessNote);
        const original = fixedRiskSubmission(
          assessmentRecord(assessment(db, site, id)),
        );
        let values: Pick<Extract<ResidualSnapshot, { method: "three_level" }>, "method" | "levelId" | "result">
          | Pick<Extract<ResidualSnapshot, { likelihood: number }>, "likelihood" | "severity" | "result"> | NonNumericResidualValues;
        if ("method" in v && (v.method === "checklist" || v.method === "narrative")) {
          if(original.body.method!==v.method)throw new HttpError(400,"원 고정 문서와 같은 방법으로만 재평가하세요.");
          values=nonnumericResidualValues(v,current.facts.criteria.body,current.facts.hazard);
        } else if ("method" in v) {
          if (original.body.method !== "three_level" || current.facts.criteria.body.method !== "three_level")
            throw new HttpError(400, "3단계 재평가는 고정된 3단계 문서에서만 입력하세요. 자동 변환하지 않습니다.");
          const criteria = threeLevelCriteriaInput.parse(current.facts.criteria.body);
          const level = criteria.levels.find((level) => level.id === v.levelId);
          if (!level) throw new HttpError(400, "고정된 원 기준에 속한 단계만 선택하세요.");
          values = {
            method: "three_level",
            levelId: level.id,
            result: {
              score: null,
              selectionKind: "human_three_level",
              levelId: level.id,
              bandLabel: level.label,
              description: level.description,
              criterionAcceptable: level.criterionAcceptable,
            },
          };
        } else {
          if (original.body.method !== "product" || current.facts.criteria.body.method !== "product")
            throw new HttpError(400, "수치 입력은 고정된 수치형 문서에서만 사용하세요. 3단계를 점수로 변환하지 않습니다.");
          const h = { ...current.facts.hazard, likelihood: v.likelihood, severity: v.severity };
          const r = riskResults(
            riskAssessmentInput.parse({ ...original.body, hazards: [riskHazardInput.parse(h)] }),
            current.facts.criteria.body,
          )[0];
          values = {
            likelihood: v.likelihood,
            severity: v.severity,
            result: { score: r.score!, bandLabel: r.bandLabel!, criterionAcceptable: r.criterionAcceptable! },
          };
        }
        const rid = randomUUID(), at = new Date().toISOString();
        const commonSnapshot: ResidualSnapshotBase = {
          id: rid,
          siteId: site,
          assessmentId: id,
          hazardId,
          kind: v.kind,
          version: v.expectedVersion + 1,
          basis: v.basis,
          claimedLocalDate: v.claimedLocalDate,
          reason: v.reason,
          actor: account(db, req.session.userId!),
          recordedAt: at,
          context: current.facts,
          contextFingerprint: current.fingerprint,
        };
        // Numeric snapshot ordering stays compatible with the original writer.
        const { basis, claimedLocalDate, reason, actor, recordedAt, context: facts, contextFingerprint, ...identity } = commonSnapshot;
        const trailing = { basis, claimedLocalDate, reason, actor, recordedAt, context: facts, contextFingerprint };
        const snapshot: ResidualSnapshot = "method" in values && (values.method === "checklist" || values.method === "narrative")
          ? { ...identity, ...trailing, ...values }
          : "method" in values ? { ...identity, method: values.method, levelId: values.levelId, ...trailing, result: values.result }
          : { ...identity, likelihood: values.likelihood, severity: values.severity, ...trailing, result: values.result };
        db.prepare("INSERT INTO risk_residuals VALUES(?,?,?,?,?,?,?,?,?)").run(
          rid,
          site,
          id,
          hazardId,
          v.kind,
          snapshot.version,
          JSON.stringify(snapshot),
          riskHash(snapshot),
          at,
        );
        audit(db, req.session.userId!, site, "risk.residual." + v.kind, rid);
        const stored = db
          .prepare("SELECT * FROM risk_residuals WHERE id=?")
          .get(rid) as ResidualRow;
        return residualRecord(stored, current);
      },
      () => {
        access(req, true, true);
        assessment(db, site, id);
      },
    );
  });
}
