import type { Db } from "./db.js";
// Additive original storage. Older meeting snapshots are not rewritten.
export function migrateMinutesAttachments(db:Db){
 db.exec(`
 PRAGMA user_version=41;
 CREATE TABLE minutes_attachments(
  id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),minutes_id TEXT NOT NULL REFERENCES minutes(id),
  filename TEXT NOT NULL,format TEXT NOT NULL CHECK(format IN ('image/png','image/jpeg')),
  size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 5242880),sha256 TEXT NOT NULL,bytes BLOB NOT NULL CHECK(length(bytes)=size),
  attached INTEGER NOT NULL CHECK(attached IN(0,1)),uploaded_by TEXT NOT NULL REFERENCES users(id),uploaded_at TEXT NOT NULL);
 CREATE INDEX minutes_attachment_minutes ON minutes_attachments(minutes_id,uploaded_at,id);
 CREATE INDEX minutes_attachment_site ON minutes_attachments(site_id);
 CREATE TRIGGER minutes_attachment_insert BEFORE INSERT ON minutes_attachments WHEN NOT EXISTS(
  SELECT 1 FROM minutes m LEFT JOIN minutes_records r ON r.minutes_id=m.id WHERE m.id=NEW.minutes_id AND m.site_id=NEW.site_id AND COALESCE(r.status,'draft')='draft')
 BEGIN SELECT RAISE(ABORT,'Attachment requires same-site draft minutes'); END;
 CREATE TRIGGER minutes_attachment_original_fixed BEFORE UPDATE ON minutes_attachments WHEN
  NEW.id IS NOT OLD.id OR NEW.site_id IS NOT OLD.site_id OR NEW.minutes_id IS NOT OLD.minutes_id OR NEW.filename IS NOT OLD.filename OR NEW.format IS NOT OLD.format OR NEW.size IS NOT OLD.size OR NEW.sha256 IS NOT OLD.sha256 OR NEW.bytes IS NOT OLD.bytes OR NEW.uploaded_by IS NOT OLD.uploaded_by OR NEW.uploaded_at IS NOT OLD.uploaded_at
 BEGIN SELECT RAISE(ABORT,'Minutes attachment original immutable'); END;
 CREATE TRIGGER minutes_attachment_state_fixed BEFORE UPDATE OF attached ON minutes_attachments WHEN EXISTS(
  SELECT 1 FROM minutes_records WHERE minutes_id=OLD.minutes_id AND status='finalized')
 BEGIN SELECT RAISE(ABORT,'Final minutes attachment manifest immutable'); END;
 CREATE TRIGGER minutes_attachment_retained BEFORE DELETE ON minutes_attachments BEGIN SELECT RAISE(ABORT,'Retained original cannot be deleted'); END;
 CREATE TABLE minutes_attachment_events(
  id INTEGER PRIMARY KEY,minutes_id TEXT NOT NULL REFERENCES minutes(id),version INTEGER NOT NULL,event TEXT NOT NULL,
  attachment_id TEXT NOT NULL REFERENCES minutes_attachments(id),actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,at TEXT NOT NULL,reason TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(minutes_id,version));
 CREATE TRIGGER minutes_attachment_event_scope BEFORE INSERT ON minutes_attachment_events WHEN NOT EXISTS(
  SELECT 1 FROM minutes_attachments WHERE id=NEW.attachment_id AND minutes_id=NEW.minutes_id)
 BEGIN SELECT RAISE(ABORT,'Attachment event minutes mismatch'); END;
 CREATE TRIGGER minutes_attachment_event_fixed BEFORE UPDATE ON minutes_attachment_events BEGIN SELECT RAISE(ABORT,'Attachment event immutable'); END;
 CREATE TRIGGER minutes_attachment_event_retained BEFORE DELETE ON minutes_attachment_events BEGIN SELECT RAISE(ABORT,'Attachment event retained'); END;
 `);
}
