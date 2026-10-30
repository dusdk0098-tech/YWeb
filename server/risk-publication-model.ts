import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import { assessment, assessmentRecord, type RiskSubmission } from "./risk-core.js";
import { fixedRiskSubmission } from "./risk-review.js";
import { riskHash } from "./risk-model.js";
export type PublicationTarget = { userId: string; name: string };
export type PublicationSnapshot = {
  id: string;
  siteId: string;
  source: { assessmentId: string; assessmentVersion: number; submissionVersion: number; submissionHash: string; title: string };
  statement: string;
  publisher: { id: string; name: string };
  publishedAt: string;
  targets: PublicationTarget[];
};
export type PublicationRow = {
  id: string; site_id: string; assessment_id: string; submission_version: number; submission_hash: string;
  snapshot: string; snapshot_hash: string; status: "published" | "withdrawn"; version: number;
  created_at: string; withdrawn_at: string | null; withdraw_reason: string | null;
};
export type PublicationAck = {
  id: string; publication_id: string; user_id: string; name: string; at: string;
  submission_hash: string; publication_hash: string; statement: string;
};
export type PublicationView = {
  id: string; siteId: string; status: PublicationRow["status"]; version: number;
  publicationHash: string; publication: Omit<PublicationSnapshot, "targets">;
  ownAck: PublicationAck | null; isTarget: boolean; canAcknowledge: boolean;
  sourceHasSuccessor: boolean; sourceStatus: string;
  withdrawnAt: string | null; withdrawReason: string | null;
  targets?: PublicationTarget[]; acknowledgements?: PublicationAck[];
};
export function publicationRow(db: Db, siteId: string, id: string) {
  const row = db.prepare("SELECT * FROM risk_publications WHERE site_id=? AND id=?").get(siteId, id) as PublicationRow | undefined;
  if (!row) throw new HttpError(404, "평가 게시본을 찾을 수 없습니다.");
  return row;
}
export function publicationTarget(db: Db, id: string, userId: string) {
  return !!db.prepare("SELECT 1 FROM risk_publication_targets WHERE publication_id=? AND user_id=?").get(id, userId);
}
export function publicationReadable(db: Db, row: PublicationRow, userId: string, manager: boolean) {
  if (!manager && !publicationTarget(db, row.id, userId)) throw new HttpError(404, "평가 게시본을 찾을 수 없습니다.");
}
export function publicationSource(db: Db, row: PublicationRow): { submission: RiskSubmission; sourceHasSuccessor: boolean; sourceStatus: string } {
  const doc = assessmentRecord(assessment(db, row.site_id, row.assessment_id));
  const submission = fixedRiskSubmission(doc);
  if (doc.submission_hash !== row.submission_hash || submission.version !== row.submission_version || submission.id !== row.assessment_id) throw new HttpError(409, "게시된 고정 평가 출처가 일치하지 않습니다.");
  return { submission, sourceHasSuccessor: !!doc.successor_id, sourceStatus: doc.status };
}
export function publicationSnapshot(db: Db, row: PublicationRow) {
  const value = JSON.parse(row.snapshot) as PublicationSnapshot;
  const targets = db.prepare("SELECT user_id userId,name FROM risk_publication_targets WHERE publication_id=? ORDER BY user_id").all(row.id) as PublicationTarget[];
  if (riskHash(value) !== row.snapshot_hash || value.id !== row.id || value.siteId !== row.site_id || value.source.assessmentId !== row.assessment_id || value.source.submissionHash !== row.submission_hash || value.source.submissionVersion !== row.submission_version || JSON.stringify(targets) !== JSON.stringify(value.targets)) throw new HttpError(409, "게시본의 고정 출처/대상 보관본이 일치하지 않습니다.");
  return value;
}
export function ownPublicationAck(db: Db, id: string, userId: string) {
  return (db.prepare("SELECT * FROM risk_publication_acks WHERE publication_id=? AND user_id=?").get(id, userId) as PublicationAck | undefined) ?? null;
}
export function publicationView(db: Db, row: PublicationRow, userId: string, manager: boolean): PublicationView {
  publicationReadable(db, row, userId, manager);
  const { targets, ...publication } = publicationSnapshot(db, row);
  const source = publicationSource(db, row);
  const isTarget = targets.some((t) => t.userId === userId);
  return {
    id: row.id, siteId: row.site_id, status: row.status, version: row.version,
    publicationHash: row.snapshot_hash, publication,
    ownAck: ownPublicationAck(db, row.id, userId), isTarget,
    canAcknowledge: isTarget && row.status === "published" && source.sourceStatus === "accepted" && !source.sourceHasSuccessor,
    sourceHasSuccessor: source.sourceHasSuccessor, sourceStatus: source.sourceStatus,
    withdrawnAt: row.withdrawn_at, withdrawReason: row.withdraw_reason,
    ...(manager ? { targets, acknowledgements: db.prepare("SELECT * FROM risk_publication_acks WHERE publication_id=? ORDER BY at,id").all(row.id) as PublicationAck[] } : {}),
  };
}
