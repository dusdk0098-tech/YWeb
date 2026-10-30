import { createHash } from "node:crypto";
import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import type { WorkStopInput, WorkStopStatus } from "./work-stop-validation.js";
export type WorkStopOriginal = {
  id: string;
  site: { id: string; name: string };
  requester: { id: string; name: string };
  body: WorkStopInput;
  requestedAt: string;
};
export type WorkStopAction = {
  actorId: string;
  actorName: string;
  recordedLocal: string;
  reason: string;
  at: string;
};
export type WorkStopReview = {
  actorId: string;
  actorName: string;
  improvements: string;
  conditions: string;
  reason: string;
  at: string;
};
export type WorkStopRow = {
  id: string;
  site_id: string;
  requester_id: string;
  original: string;
  original_hash: string;
  status: WorkStopStatus;
  version: number;
  assignee_id: string | null;
  stop_record: string | null;
  review_record: string | null;
  resumption_record: string | null;
  created_at: string;
  updated_at: string;
};
export type WorkStopRecord = Omit<
  WorkStopRow,
  "original" | "stop_record" | "review_record" | "resumption_record"
> & {
  original: WorkStopOriginal;
  stop_record: WorkStopAction | null;
  review_record: WorkStopReview | null;
  resumption_record: (WorkStopAction & { conditions: string }) | null;
  eligibleReviewerCount: number;
};
export type WorkStopEvent = {
  id: number;
  record_id: string;
  version: number;
  event: string;
  actor_id: string;
  actor_name: string;
  at: string;
  note: string;
  snapshot: string;
};
export const workStopHash = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export function workStopRow(db: Db, site: string, id: string) {
  const row = db
    .prepare("SELECT * FROM work_stops WHERE site_id=? AND id=?")
    .get(site, id) as WorkStopRow | undefined;
  if (!row) throw new HttpError(404, "요청 기록을 찾을 수 없습니다.");
  return row;
}
export function workStopRecord(db: Db, row: WorkStopRow): WorkStopRecord {
  if (workStopHash(row.original) !== row.original_hash)
    throw new HttpError(409, "원 요청 기록 hash가 일치하지 않습니다.");
  const original = JSON.parse(row.original) as WorkStopOriginal;
  if (
    original.id !== row.id ||
    original.site.id !== row.site_id ||
    original.requester.id !== row.requester_id
  )
    throw new HttpError(409, "원 요청 참조가 일치하지 않습니다.");
  const review = row.review_record
    ? (JSON.parse(row.review_record) as WorkStopReview)
    : null;
  const count = db
    .prepare(
      "SELECT count(*) n FROM memberships WHERE site_id=? AND role='manager' AND user_id!=? AND user_id!=?",
    )
    .get(row.site_id, row.requester_id, review?.actorId || "") as { n: number };
  return {
    ...row,
    original,
    stop_record: row.stop_record ? JSON.parse(row.stop_record) : null,
    review_record: review,
    resumption_record: row.resumption_record
      ? JSON.parse(row.resumption_record)
      : null,
    eligibleReviewerCount: count.n,
  };
}
