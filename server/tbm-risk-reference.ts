import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import { assessment, assessmentRecord, type RiskSubmission } from "./risk-core.js";
import { fixedRiskSubmission } from "./risk-review.js";
import { revision } from "./validation.js";
export const tbmRiskSourceInput = z.object({
  assessmentId: z.uuid(), submissionVersion: revision,
  submissionHash: z.string().regex(/^[a-f0-9]{64}$/),
  hazardIds: z.array(z.uuid()).min(1).max(50),
}).strict().superRefine((v, c) => {
  if (new Set(v.hazardIds).size !== v.hazardIds.length)
    c.addIssue({ code: "custom", message: "위험행 ID는 중복할 수 없습니다." });
});
export const tbmRiskReferenceInput = z.object({
  version: revision, source: tbmRiskSourceInput.nullable(),
}).strict();
export type TbmRiskSourceInput = z.infer<typeof tbmRiskSourceInput>;
export type TbmRiskReference = {
  schemaVersion: 1;
  assessmentId: string; siteId: string;
  submissionVersion: number; submissionHash: string;
  title: string; date: string; method: RiskSubmission["body"]["method"];
  hazards: { id: string; task: string; location: string; scenario: string; harm: string; currentControls: string }[];
};
// A deliberately limited descriptive excerpt: no scoring, outcomes, action records,
// attendance, publication acknowledgments, or claims of teaching/comprehension.
export function summarizeTbmRiskSource(submission: Pick<RiskSubmission, "id" | "siteId" | "version" | "body">, hash: string, ids: string[]): TbmRiskReference {
  if (!ids.length || ids.length > 50 || new Set(ids).size !== ids.length)
    throw new HttpError(400, "서로 다른 위험행 1–50개를 선택하세요.");
  const selected = new Set(ids);
  const hazards = submission.body.hazards.filter((h) => selected.has(h.id)).map((h) => ({
    id: h.id, task: h.task, location: h.location, scenario: h.scenario,
    harm: h.harm, currentControls: h.currentControls,
  }));
  if (hazards.length !== ids.length) throw new HttpError(409, "선택한 위험행이 고정 제출본에 없습니다.");
  return { schemaVersion: 1, assessmentId: submission.id, siteId: submission.siteId,
    submissionVersion: submission.version, submissionHash: hash,
    title: submission.body.title, date: submission.body.date, method: submission.body.method, hazards };
}
export function selectTbmRiskReference(db: Db, siteId: string, source: TbmRiskSourceInput) {
  const row = assessmentRecord(assessment(db, siteId, source.assessmentId));
  const fixed = fixedRiskSubmission(row);
  if (row.status !== "accepted" || row.successor_id || fixed.version !== source.submissionVersion || row.submission_hash !== source.submissionHash)
    throw new HttpError(409, "후속 문서가 없는 수락 평가의 정확한 제출본을 선택하세요.");
  return summarizeTbmRiskSource(fixed, source.submissionHash, source.hazardIds);
}
export function tbmRiskReference(db: Db, sessionId: string): TbmRiskReference | null {
  const row = db.prepare("SELECT body FROM tbm_risk_references WHERE session_id=?").get(sessionId) as {body: string} | undefined;
  return row ? JSON.parse(row.body) as TbmRiskReference : null;
}
export function storeTbmRiskReference(db: Db, sessionId: string, ref: TbmRiskReference | null) {
  db.prepare("DELETE FROM tbm_risk_references WHERE session_id=?").run(sessionId);
  if (ref) db.prepare("INSERT INTO tbm_risk_references(session_id,assessment_id,submission_version,submission_hash,body) VALUES(?,?,?,?,?)")
    .run(sessionId, ref.assessmentId, ref.submissionVersion, ref.submissionHash, JSON.stringify(ref));
}
export function currentTbmRiskSource(db: Db, siteId: string, ref: TbmRiskReference) {
  if (ref.siteId !== siteId) throw new HttpError(409, "TBM 출처 현장이 일치하지 않습니다.");
  const row = assessmentRecord(assessment(db, siteId, ref.assessmentId));
  const submission = fixedRiskSubmission(row);
  if (row.submission_hash !== ref.submissionHash || submission.version !== ref.submissionVersion ||
      JSON.stringify(summarizeTbmRiskSource(submission, ref.submissionHash, ref.hazards.map((h) => h.id))) !== JSON.stringify(ref))
    throw new HttpError(409, "TBM 고정 평가 출처가 일치하지 않습니다.");
  return { submission, sourceHasSuccessor: !!row.successor_id, sourceStatus: row.status };
}
export function finalizeTbmRiskReference(db: Db, siteId: string, ref: TbmRiskReference | null,
  acknowledgeHistoricalSource: boolean, actor: { id: string; name: string }, at: string) {
  if (!ref) return null;
  const current = currentTbmRiskSource(db, siteId, ref);
  if (current.sourceStatus !== "accepted") throw new HttpError(409, "참조 평가의 수락 상태를 확인하세요.");
  if (current.sourceHasSuccessor && !acknowledgeHistoricalSource)
    throw new HttpError(409, "후속 평가가 있습니다. 당시 고정 출처 사용을 명시적으로 확인하거나 참조를 교체하세요.");
  return { reference: ref, sourceHasSuccessorAtFinalization: current.sourceHasSuccessor,
    historicalSourceAcknowledgment: current.sourceHasSuccessor ? { actor, at } : null };
}
