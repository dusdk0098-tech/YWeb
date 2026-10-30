import type { Express } from "express";
import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { readRiskDocument, RISK_REPORT_MAX_BYTES, type RiskDocumentReport } from "./risk-document-report.js";
/** Export version is independent of database schema. Explicit whitelist, not a database backup. */
export function riskExportValue(report: RiskDocumentReport) {
  return {
    format: "pedit-risk-assessment" as const,
    schemaVersion: 1 as const,
    exportedAt: report.generatedAt,
    readFingerprint: report.fingerprint,
    scope: {
      fixedSource: "complete submitted assessment including its fixed criteria and creation-time reuse provenance",
      currentSummary: "current document status/decision/direct successor and record counts only; not historical state reconstruction",
      excluded: ["current action details", "residual record details", "full change history", "private account opinions", "publication recipient lists", "account acknowledgments", "attachment originals"],
      completeWithinDeclaredScope: true,
      safetyClearance: false,
      signatureOrIdentityProof: false,
    },
    fixedSource: {
      submissionHash: report.document.submissionHash,
      submission: report.submission,
      reuseProvenance: report.reuseSource,
    },
    currentSummary: {
      site: { id: report.site.id, name: report.site.name },
      document: {
        id: report.document.id,
        currentVersion: report.document.currentVersion,
        status: report.document.status,
        parentId: report.document.parentId,
        successorId: report.document.successorId,
        successorStatus: report.document.successorStatus,
        submissionHash: report.document.submissionHash,
        decision: report.document.decision,
      },
      counts: {
        hazards: report.counts.hazards,
        plans: report.counts.plans,
        actions: report.counts.actions,
        latestResiduals: report.counts.latestResiduals,
        allResidualHistoryRecords: report.counts.allResidualHistoryRecords,
      },
    },
  };
}
export function serializeRiskExport(value: ReturnType<typeof riskExportValue>) {
  const json = JSON.stringify(value) + "\n";
  if (Buffer.byteLength(json, "utf8") > RISK_REPORT_MAX_BYTES)
    throw new HttpError(400,"JSON 내보내기256KiB 한도를 초과했습니다. 일부 내용 생략 없이 전체 중단합니다.");
  return json;
}
export function registerRiskDocumentExport(app: Express, db: Db, {access}: SiteOperations) {
  app.get("/api/sites/:siteId/risk-assessments/:id/export.json", (req,res) => {
    access(req);
    const q=z.object({expectedFingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(req.query);
    const report=readRiskDocument(db,String(req.params.siteId),String(req.params.id),()=>{access(req);});
    if(report.fingerprint!==q.expectedFingerprint)
      throw new HttpError(409,"내보내기 준비 후 조회 정보가 바뀌었습니다. 다시 준비하세요.");
    const payload=serializeRiskExport(riskExportValue(report));
    // IDs are generated UUIDs, not user-controlled titles. Validate before using as a header token.
    const id=z.uuid().parse(report.document.id),version=z.number().int().positive().parse(report.submission.version);
    res.set({"Content-Type":"application/json; charset=utf-8","Content-Disposition":`attachment; filename="pedit-risk-${id}-submission-v${version}.json"`,"Cache-Control":"no-store"}).send(payload);
  });
}
