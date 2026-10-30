import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import type { TemplateBody, InspectionBody } from "./inspection-validation.js";
export type TemplateSnapshot = {
  id: string;
  version: number;
  body: TemplateBody;
  siteName: string;
  publishedBy: { id: string; name: string };
  publishedAt: string;
};
export type TemplateRow = {
  id: string;
  site_id: string;
  parent_id: string | null;
  body: string;
  status: "draft" | "published";
  version: number;
  published_snapshot: string | null;
  created_at: string;
};
export type InspectionSnapshot = {
  id: string;
  template: TemplateSnapshot;
  body: InspectionBody;
  submitter: { id: string; name: string };
  submittedAt: string;
};
export type InspectionReview = {
  actor: { id: string; name: string };
  at: string;
  reason: string;
  successorId?: string;
};
export type InspectionRow = {
  id: string;
  site_id: string;
  template_id: string;
  template_snapshot: string;
  owner_id: string;
  parent_id: string | null;
  body: string;
  status: "draft" | "submitted" | "accepted" | "returned";
  version: number;
  submitted_snapshot: string | null;
  review: string | null;
  created_at: string;
};
export const templateRecord = (r: TemplateRow) => ({
  ...r,
  body: JSON.parse(r.body) as TemplateBody,
  published_snapshot: r.published_snapshot
    ? (JSON.parse(r.published_snapshot) as TemplateSnapshot)
    : null,
});
export const inspectionRecord = (r: InspectionRow) => ({
  ...r,
  body: JSON.parse(r.body) as InspectionBody,
  template_snapshot: JSON.parse(r.template_snapshot) as TemplateSnapshot,
  submitted_snapshot: r.submitted_snapshot
    ? (JSON.parse(r.submitted_snapshot) as InspectionSnapshot)
    : null,
  review: r.review ? (JSON.parse(r.review) as InspectionReview) : null,
});
export function getTemplate(db: Db, site: string, id: string) {
  const r = db
    .prepare("SELECT * FROM inspection_templates WHERE site_id=? AND id=?")
    .get(site, id) as TemplateRow | undefined;
  if (!r) throw new HttpError(404, "점검 양식을 찾을 수 없습니다.");
  return r;
}
export function getInspection(db: Db, site: string, id: string) {
  const r = db
    .prepare("SELECT * FROM inspections WHERE site_id=? AND id=?")
    .get(site, id) as InspectionRow | undefined;
  if (!r) throw new HttpError(404, "점검 기록을 찾을 수 없습니다.");
  return r;
}
export function account(db: Db, id: string) {
  return db.prepare("SELECT id,name FROM users WHERE id=?").get(id) as {
    id: string;
    name: string;
  };
}
export function checkVersion(
  row: { version: number; status: string },
  version: number,
  status: string,
) {
  if (row.version !== version || row.status !== status)
    throw new HttpError(
      409,
      "상태 또는 버전이 변경되었습니다. 입력을 보관하고 최신본을 다시 여세요.",
    );
}
