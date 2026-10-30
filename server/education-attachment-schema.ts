import type { Db } from "./db.js";
// Additive original storage. Older education journal snapshots are not rewritten.
export function migrateEducationAttachments(db:Db){
 db.exec(`
 PRAGMA user_version=49;
 CREATE TABLE education_attachments(
  id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),session_id TEXT NOT NULL REFERENCES education_sessions(id),
  filename TEXT NOT NULL,format TEXT NOT NULL CHECK(format IN ('image/png','image/jpeg','application/pdf')),
  size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 5242880),sha256 TEXT NOT NULL,bytes BLOB NOT NULL CHECK(length(bytes)=size),
  attached INTEGER NOT NULL CHECK(attached IN(0,1)),uploaded_by TEXT NOT NULL REFERENCES users(id),uploaded_at TEXT NOT NULL);
 CREATE INDEX education_attachment_session ON education_attachments(session_id,uploaded_at,id);
 CREATE INDEX education_attachment_site ON education_attachments(site_id);
 CREATE TRIGGER education_attachment_insert BEFORE INSERT ON education_attachments WHEN NOT EXISTS(
  SELECT 1 FROM education_sessions m WHERE m.id=NEW.session_id AND m.site_id=NEW.site_id AND m.status='draft')
 BEGIN SELECT RAISE(ABORT,'Attachment requires same-site draft education journal'); END;
 CREATE TRIGGER education_attachment_original_fixed BEFORE UPDATE ON education_attachments WHEN
  NEW.id IS NOT OLD.id OR NEW.site_id IS NOT OLD.site_id OR NEW.session_id IS NOT OLD.session_id OR NEW.filename IS NOT OLD.filename OR NEW.format IS NOT OLD.format OR NEW.size IS NOT OLD.size OR NEW.sha256 IS NOT OLD.sha256 OR NEW.bytes IS NOT OLD.bytes OR NEW.uploaded_by IS NOT OLD.uploaded_by OR NEW.uploaded_at IS NOT OLD.uploaded_at
 BEGIN SELECT RAISE(ABORT,'Education attachment original immutable'); END;
 CREATE TRIGGER education_attachment_state_fixed BEFORE UPDATE OF attached ON education_attachments WHEN EXISTS(
  SELECT 1 FROM education_sessions WHERE id=OLD.session_id AND status='archived')
 BEGIN SELECT RAISE(ABORT,'Final education journal attachment manifest immutable'); END;
 CREATE TRIGGER education_attachment_retained BEFORE DELETE ON education_attachments BEGIN SELECT RAISE(ABORT,'Retained original cannot be deleted'); END;
 CREATE TABLE education_attachment_events(
  id INTEGER PRIMARY KEY,session_id TEXT NOT NULL REFERENCES education_sessions(id),version INTEGER NOT NULL,event TEXT NOT NULL,
  attachment_id TEXT NOT NULL REFERENCES education_attachments(id),actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,at TEXT NOT NULL,reason TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(session_id,version));
 CREATE TRIGGER education_attachment_event_scope BEFORE INSERT ON education_attachment_events WHEN NOT EXISTS(
  SELECT 1 FROM education_attachments WHERE id=NEW.attachment_id AND session_id=NEW.session_id)
 BEGIN SELECT RAISE(ABORT,'Attachment event education journal mismatch'); END;
 CREATE TRIGGER education_attachment_event_fixed BEFORE UPDATE ON education_attachment_events BEGIN SELECT RAISE(ABORT,'Attachment event immutable'); END;
 CREATE TRIGGER education_attachment_event_retained BEFORE DELETE ON education_attachment_events BEGIN SELECT RAISE(ABORT,'Attachment event retained'); END;
 CREATE TABLE education_archive_attachments(
  session_id TEXT PRIMARY KEY REFERENCES education_snapshots(session_id),snapshot_hash TEXT NOT NULL,manifest TEXT NOT NULL,hash TEXT NOT NULL);
 CREATE TRIGGER education_archive_attachment_source BEFORE INSERT ON education_archive_attachments WHEN NOT EXISTS(
  SELECT 1 FROM education_snapshots s JOIN education_sessions e ON e.id=s.session_id WHERE s.session_id=NEW.session_id AND s.hash=NEW.snapshot_hash AND e.status='archived')
 BEGIN SELECT RAISE(ABORT,'Education manifest requires exact archived snapshot'); END;
 CREATE TRIGGER education_archive_attachment_fixed BEFORE UPDATE ON education_archive_attachments BEGIN SELECT RAISE(ABORT,'Education manifest immutable'); END;
 CREATE TRIGGER education_archive_attachment_retained BEFORE DELETE ON education_archive_attachments BEGIN SELECT RAISE(ABORT,'Education manifest retained'); END;
 `);
}
