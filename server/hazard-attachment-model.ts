import type { Db } from "./db.js";
export type HazardAttachment = {
  id: string;
  filename: string;
  format: string;
  size: number;
  sha256: string;
  attached: number;
  uploaded_by: string;
  uploaded_at: string;
};
export function hazardAttachments(
  db: Db,
  reportId: string,
): HazardAttachment[] {
  return db
    .prepare(
      `SELECT id,filename,format,size,sha256,attached,uploaded_by,uploaded_at
    FROM hazard_attachments WHERE report_id=? ORDER BY uploaded_at,id`,
    )
    .all(reportId) as HazardAttachment[];
}
export function attachmentManifest(db: Db, reportId: string) {
  return hazardAttachments(db, reportId).filter((a) => a.attached === 1);
}
