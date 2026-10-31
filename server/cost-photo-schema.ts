import type { Db } from "./db.js";
// Original PEDIT-SC renderer/modules/constants.js photoGroups; output is per group, 2 photos per page.
export const photoGroups = ["신호수", "안전보호구 등", "안전시설비 등", "기타 사진대지"] as const;
// IF NOT EXISTS: older-schema test fixtures drop only the tables they know about.
// SC 사진대지 표시본: browser re-encoded JPEG (EXIF removed) for an image evidence original. Original stays download-only.
// Image bytes are fixed; only the 사진대지 labels change, and only while the month is open.
export function migrateCostPhotos(db: Db) {
  db.exec(`
 CREATE TABLE IF NOT EXISTS cost_evidence_displays(
  attachment_id TEXT PRIMARY KEY REFERENCES cost_evidence_files(id),site_id TEXT NOT NULL REFERENCES sites(id),period_id TEXT NOT NULL REFERENCES cost_periods(id),
  width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 2048),height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 2048),
  size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 1048576),sha256 TEXT NOT NULL,bytes BLOB NOT NULL CHECK(length(bytes)=size),
  created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,
  group_name TEXT NOT NULL CHECK(group_name IN ('신호수','안전보호구 등','안전시설비 등','기타 사진대지')),
  taken_date TEXT NOT NULL,description TEXT NOT NULL,included INTEGER NOT NULL CHECK(included IN(0,1)),label_version INTEGER NOT NULL CHECK(label_version>=1));
 CREATE INDEX IF NOT EXISTS cost_evidence_displays_site ON cost_evidence_displays(site_id);
 CREATE INDEX IF NOT EXISTS cost_evidence_displays_period ON cost_evidence_displays(period_id);
 CREATE TRIGGER IF NOT EXISTS cost_display_source BEFORE INSERT ON cost_evidence_displays WHEN NOT EXISTS(
  SELECT 1 FROM cost_evidence_files f JOIN cost_periods p ON p.id=f.period_id
  WHERE f.id=NEW.attachment_id AND f.period_id=NEW.period_id AND f.site_id=NEW.site_id AND f.format IN('image/png','image/jpeg') AND p.status='open')
 BEGIN SELECT RAISE(ABORT,'Display requires same-period image original in open period'); END;
 CREATE TRIGGER IF NOT EXISTS cost_display_fixed BEFORE UPDATE ON cost_evidence_displays WHEN
  NEW.attachment_id IS NOT OLD.attachment_id OR NEW.site_id IS NOT OLD.site_id OR NEW.period_id IS NOT OLD.period_id OR
  NEW.width IS NOT OLD.width OR NEW.height IS NOT OLD.height OR NEW.size IS NOT OLD.size OR NEW.sha256 IS NOT OLD.sha256 OR
  NEW.bytes IS NOT OLD.bytes OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at OR
  NOT EXISTS(SELECT 1 FROM cost_periods WHERE id=OLD.period_id AND status='open')
 BEGIN SELECT RAISE(ABORT,'Display image fixed; labels only while open'); END;
 CREATE TRIGGER IF NOT EXISTS cost_display_retained BEFORE DELETE ON cost_evidence_displays BEGIN SELECT RAISE(ABORT,'Display retained'); END;
 PRAGMA user_version=60;
`);
}
