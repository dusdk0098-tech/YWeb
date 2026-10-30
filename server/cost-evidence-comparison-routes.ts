import { escapeHtml } from "./print.js";
import type { Express } from "express";
import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { boundedComparisonJson, buildEvidenceComparison, type EvidenceComparison } from "./cost-evidence-comparison.js";
const fields = { closureId: z.uuid().optional(), baselineId: z.uuid().optional() };
const one = (v: { closureId?: string; baselineId?: string }) => Boolean(v.closureId) !== Boolean(v.baselineId);
export const comparisonSelection = z.object(fields).strict().refine(one, "마감 또는 기준본 하나를 선택하세요.");
const selected = z.object({ ...fields, expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict().refine(one);
export function renderEvidenceComparison(value: EvidenceComparison) {
  const escaped = escapeHtml(boundedComparisonJson(value));
  const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>고정 증빙과 현재 비교</title><h1>고정 증빙과 현재 비교</h1><p>저장 메타데이터와 참조만 비교합니다. 원본 바이트 재검사·악성코드 검사·증빙 적격 판정·금액 배분이 아닙니다. source는 고정 당시, current는 조회 당시이며 과거 재현이 아닙니다.</p><pre>${escaped}</pre></html>`;
  if (Buffer.byteLength(html) > 4 * 1024 * 1024) throw new HttpError(409, "HTML 전체 출력 한도 초과. 기존 고정 목록과 개별 기록을 확인하세요.");
  return html;
}
export function registerCostEvidenceComparison(app: Express, db: Db, { access }: SiteOperations) {
  const base = "/api/sites/:siteId/cost-periods/:id/evidence-comparison";
  for (const action of ["prepare", "compare", "print", "export.json"] as const) app.get(`${base}/${action}`, (req, res) => {
    const input = action === "prepare" ? comparisonSelection.parse(req.query) : selected.parse(req.query);
    db.exec("BEGIN DEFERRED");
    let result: EvidenceComparison;
    try {
      access(req, true, true);
      result = buildEvidenceComparison(db, String(req.params.siteId), String(req.params.id), input.closureId ? { closureId: input.closureId } : { baselineId: input.baselineId! });
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    res.set("Cache-Control", "no-store");
    if (action !== "prepare" && result.state === "ready" && result.fingerprint !== (input as z.infer<typeof selected>).expectedFingerprint) throw new HttpError(409, "준비 뒤 자료가 변경되었습니다. 다시 준비하고 비교하세요.");
    if (action === "prepare" && result.state === "ready") {
      const prepared = { ...result, changes: undefined };
      return res.type("json").send(boundedComparisonJson(prepared));
    }
    if (action === "print" || action === "export.json") {
      if (result.state !== "ready") throw new HttpError(409, result.reason);
      if (action === "print") return res.type("html").send(renderEvidenceComparison(result));
      res.attachment(`cost-evidence-comparison-${result.source.closureId}.json`);
    }
    return res.type("json").send(boundedComparisonJson(result));
  });
}
