import type { Db } from "./db.js";
export function migrateHazardAttachments(db: Db) {
  db.exec(`
    CREATE TABLE hazard_attachments (
      id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id),
      report_id TEXT NOT NULL REFERENCES hazard_reports(id),
      filename TEXT NOT NULL, format TEXT NOT NULL CHECK(format IN ('image/png','image/jpeg')),
      size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 5242880), sha256 TEXT NOT NULL,
      bytes BLOB NOT NULL CHECK(length(bytes)=size), attached INTEGER NOT NULL CHECK(attached IN (0,1)),
      uploaded_by TEXT NOT NULL REFERENCES users(id), uploaded_at TEXT NOT NULL);
    CREATE INDEX hazard_attachment_report ON hazard_attachments(report_id,uploaded_at,id);
    CREATE INDEX hazard_attachment_site ON hazard_attachments(site_id);
    CREATE TRIGGER hazard_attachment_insert_guard BEFORE INSERT ON hazard_attachments
      WHEN NOT EXISTS(SELECT 1 FROM hazard_reports WHERE id=NEW.report_id AND site_id=NEW.site_id AND status='draft')
      BEGIN SELECT RAISE(ABORT,'Attachment requires matching draft'); END;
    CREATE TRIGGER hazard_attachment_original_immutable BEFORE UPDATE ON hazard_attachments
      WHEN NEW.id IS NOT OLD.id OR NEW.site_id IS NOT OLD.site_id OR NEW.report_id IS NOT OLD.report_id
        OR NEW.filename IS NOT OLD.filename OR NEW.format IS NOT OLD.format OR NEW.size IS NOT OLD.size
        OR NEW.sha256 IS NOT OLD.sha256 OR NEW.bytes IS NOT OLD.bytes
        OR NEW.uploaded_by IS NOT OLD.uploaded_by OR NEW.uploaded_at IS NOT OLD.uploaded_at
      BEGIN SELECT RAISE(ABORT,'Attachment original is immutable'); END;
    CREATE TRIGGER hazard_attachment_state_guard BEFORE UPDATE OF attached ON hazard_attachments
      WHEN NOT EXISTS(SELECT 1 FROM hazard_reports WHERE id=OLD.report_id AND status='draft')
      BEGIN SELECT RAISE(ABORT,'Submitted attachment manifest is frozen'); END;
    CREATE TRIGGER hazard_attachment_no_delete BEFORE DELETE ON hazard_attachments
      BEGIN SELECT RAISE(ABORT,'Retained attachment cannot be deleted'); END;
    PRAGMA user_version=10;
  `);
}
