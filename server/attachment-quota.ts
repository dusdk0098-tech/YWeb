import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
export type AttachmentQuota = Readonly<{
  reportCount: number;
  siteCount: number;
  siteBytes: number;
  totalBytes: number;
}>;
export const ATTACHMENT_QUOTA: AttachmentQuota = Object.freeze({
  reportCount: 20,
  siteCount: 200,
  siteBytes: 100 * 1024 * 1024,
  totalBytes: 512 * 1024 * 1024,
});

export type AttachmentUsage = {
  reportCount: number;
  siteCount: number;
  siteBytes: number;
  totalBytes: number;
};
export function attachmentUsage(
  db: Db,
  site: string,
  report: string,
  kind: "hazard" | "minutes" | "work_plan" | "cost" | "education" | "photo_board" | "library" = "hazard",
): AttachmentUsage {
  const siteUsage = db
    .prepare(
      "SELECT count(*) AS count,coalesce(sum(size),0) AS bytes FROM (SELECT size FROM hazard_attachments WHERE site_id=? UNION ALL SELECT size FROM minutes_attachments WHERE site_id=? UNION ALL SELECT size FROM work_plan_attachments WHERE site_id=? UNION ALL SELECT size FROM cost_evidence_files WHERE site_id=? UNION ALL SELECT size FROM education_attachments WHERE site_id=? UNION ALL SELECT size FROM photo_board_photos WHERE site_id=? UNION ALL SELECT size FROM library_files WHERE site_id=?)",
    )
    .get(site, site, site, site, site, site, site) as { count: number; bytes: number };
  // 사진 표시본 bytes (SC 사진대지, 사진 보드) share the storage limits but not the file-count limits.
  const displayBytes = (where: string, ...args: string[]) =>
    (db.prepare("SELECT coalesce(sum(size),0) AS n FROM cost_evidence_displays" + where).get(...args) as { n: number }).n +
    (db.prepare("SELECT coalesce(sum(display_size),0) AS n FROM photo_board_photos" + where).get(...args) as { n: number }).n;
  return {
    siteCount: siteUsage.count,
    siteBytes: siteUsage.bytes + displayBytes(" WHERE site_id=?", site),
    reportCount: (
      db
        .prepare(
          kind === "hazard" ? "SELECT count(*) AS n FROM hazard_attachments WHERE report_id=?" : kind === "minutes" ? "SELECT count(*) AS n FROM minutes_attachments WHERE minutes_id=?" : kind === "work_plan" ? "SELECT count(*) AS n FROM work_plan_attachments WHERE plan_id=?" : kind === "cost" ? "SELECT count(*) AS n FROM cost_evidence_files WHERE period_id=?" : kind === "photo_board" ? "SELECT count(*) AS n FROM photo_board_photos WHERE board_id=?" : kind === "library" ? "SELECT count(*) AS n FROM library_files WHERE site_id=?" : "SELECT count(*) AS n FROM education_attachments WHERE session_id=?",
        )
        .get(report) as { n: number }
    ).n,
    totalBytes: (
      db
        .prepare("SELECT coalesce(sum(size),0) AS n FROM (SELECT size FROM hazard_attachments UNION ALL SELECT size FROM minutes_attachments UNION ALL SELECT size FROM work_plan_attachments UNION ALL SELECT size FROM cost_evidence_files UNION ALL SELECT size FROM education_attachments UNION ALL SELECT size FROM photo_board_photos UNION ALL SELECT size FROM library_files)")
        .get() as { n: number }
    ).n + displayBytes(""),
  };
}
// Route uses the fixed default. Optional lower limits are for small deterministic tests,
// not request/AppConfig/environment configuration; raising production limits is rejected.
export function enforceAttachmentQuota(
  usage: AttachmentUsage,
  incoming: number,
  limits: AttachmentQuota = ATTACHMENT_QUOTA,
) {
  for (const key of Object.keys(
    ATTACHMENT_QUOTA,
  ) as (keyof AttachmentQuota)[]) {
    if (
      !Number.isSafeInteger(limits[key]) ||
      limits[key] < 1 ||
      limits[key] > ATTACHMENT_QUOTA[key]
    )
      throw new Error("Invalid bounded quota limits");
  }
  if (!Number.isSafeInteger(incoming) || incoming < 1)
    throw new Error("Invalid attachment size");
  if (
    usage.reportCount >= limits.reportCount ||
    usage.siteCount >= limits.siteCount ||
    usage.siteBytes + incoming > limits.siteBytes ||
    usage.totalBytes + incoming > limits.totalBytes
  )
    throw new HttpError(
      409,
      "보존 첨부 한도에 도달했습니다. 분리한 원본도 포함되며 삭제로 공간을 회수하는 기능은 없습니다.",
    );
}
