import { validatePacketSnapshot } from "./work-plan-packet.js";
import { validateWorkPlanAttachments, type WorkPlanAttachmentManifest } from "./work-plan-attachment-model.js";
import { workPlanReviewView } from "./work-plan-review-model.js";
import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import type { WorkPlanBody } from "./work-plan-validation.js";
import type { WorkPlanSource } from "./work-plan-sources.js";
export type WorkPlanRow = {
  id: string;
  site_id: string;
  body: string;
  status: "draft" | "archived";
  version: number;
  author_id: string;
  parent_id: string | null;
  revision_reason: string;
  source_capture: string | null;
  created_at: string;
  updated_at: string;
};
export type WorkPlanSnapshot = {
  recordKind?: "author_submission";
  attachmentManifest?: WorkPlanAttachmentManifest;
  id: string;
  version: number;
  site: { id: string; name: string };
  author: { id: string; name: string };
  parentId: string | null;
  revisionReason: string;
  body: WorkPlanBody;
  source: WorkPlanSource;
  archivedBy: { id: string; name: string };
  archivedAt: string;
};
export const workPlanRecord = (r: WorkPlanRow) => ({
  ...r,
  body: JSON.parse(r.body) as WorkPlanBody,
  source_capture: r.source_capture
    ? (JSON.parse(r.source_capture) as WorkPlanSource)
    : null,
});
export function getWorkPlan(db: Db, site: string, id: string) {
  const r = db
    .prepare("SELECT * FROM work_plans WHERE site_id=? AND id=?")
    .get(site, id) as WorkPlanRow | undefined;
  if (!r) throw new HttpError(404, "작업계획 기록을 찾을 수 없습니다.");
  return r;
}
export function fullWorkPlan(db: Db, r: WorkPlanRow) {
  const snap = db
      .prepare("SELECT body,hash FROM work_plan_snapshots WHERE plan_id=?")
      .get(r.id) as { body: string; hash: string } | undefined,
    child = db
      .prepare("SELECT id FROM work_plans WHERE parent_id=? AND site_id=?")
      .get(r.id, r.site_id) as { id: string } | undefined;
  if(snap){validateWorkPlanAttachments(db,r.id,JSON.parse(snap.body));validatePacketSnapshot(JSON.parse(snap.body));}
  return {
    ...workPlanRecord(r),
    documentReview: workPlanReviewView(db,r),
    snapshot: snap
      ? { body: JSON.parse(snap.body) as WorkPlanSnapshot, hash: snap.hash }
      : null,
    successorId: child?.id || null,
  };
}
