import type { Db } from "./db.js";
// Additive original storage. Older work plan snapshots are not rewritten.
export function migrateWorkPlanAttachments(db:Db){
 db.exec(`
 PRAGMA user_version=43;
 CREATE TABLE work_plan_attachments(
  id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),plan_id TEXT NOT NULL REFERENCES work_plans(id),
  filename TEXT NOT NULL,format TEXT NOT NULL CHECK(format IN ('image/png','image/jpeg','application/pdf')),
  size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 5242880),sha256 TEXT NOT NULL,bytes BLOB NOT NULL CHECK(length(bytes)=size),
  attached INTEGER NOT NULL CHECK(attached IN(0,1)),uploaded_by TEXT NOT NULL REFERENCES users(id),uploaded_at TEXT NOT NULL);
 CREATE INDEX work_plan_attachment_plan ON work_plan_attachments(plan_id,uploaded_at,id);
 CREATE INDEX work_plan_attachment_site ON work_plan_attachments(site_id);
 CREATE TRIGGER work_plan_attachment_insert BEFORE INSERT ON work_plan_attachments WHEN NOT EXISTS(
  SELECT 1 FROM work_plans m WHERE m.id=NEW.plan_id AND m.site_id=NEW.site_id AND m.status='draft')
 BEGIN SELECT RAISE(ABORT,'Attachment requires same-site draft work plan'); END;
 CREATE TRIGGER work_plan_attachment_original_fixed BEFORE UPDATE ON work_plan_attachments WHEN
  NEW.id IS NOT OLD.id OR NEW.site_id IS NOT OLD.site_id OR NEW.plan_id IS NOT OLD.plan_id OR NEW.filename IS NOT OLD.filename OR NEW.format IS NOT OLD.format OR NEW.size IS NOT OLD.size OR NEW.sha256 IS NOT OLD.sha256 OR NEW.bytes IS NOT OLD.bytes OR NEW.uploaded_by IS NOT OLD.uploaded_by OR NEW.uploaded_at IS NOT OLD.uploaded_at
 BEGIN SELECT RAISE(ABORT,'Work plan attachment original immutable'); END;
 CREATE TRIGGER work_plan_attachment_state_fixed BEFORE UPDATE OF attached ON work_plan_attachments WHEN EXISTS(
  SELECT 1 FROM work_plans WHERE id=OLD.plan_id AND status='archived')
 BEGIN SELECT RAISE(ABORT,'Final work plan attachment manifest immutable'); END;
 CREATE TRIGGER work_plan_attachment_retained BEFORE DELETE ON work_plan_attachments BEGIN SELECT RAISE(ABORT,'Retained original cannot be deleted'); END;
 CREATE TABLE work_plan_attachment_events(
  id INTEGER PRIMARY KEY,plan_id TEXT NOT NULL REFERENCES work_plans(id),version INTEGER NOT NULL,event TEXT NOT NULL,
  attachment_id TEXT NOT NULL REFERENCES work_plan_attachments(id),actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,at TEXT NOT NULL,reason TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(plan_id,version));
 CREATE TRIGGER work_plan_attachment_event_scope BEFORE INSERT ON work_plan_attachment_events WHEN NOT EXISTS(
  SELECT 1 FROM work_plan_attachments WHERE id=NEW.attachment_id AND plan_id=NEW.plan_id)
 BEGIN SELECT RAISE(ABORT,'Attachment event work plan mismatch'); END;
 CREATE TRIGGER work_plan_attachment_event_fixed BEFORE UPDATE ON work_plan_attachment_events BEGIN SELECT RAISE(ABORT,'Attachment event immutable'); END;
 CREATE TRIGGER work_plan_attachment_event_retained BEFORE DELETE ON work_plan_attachment_events BEGIN SELECT RAISE(ABORT,'Attachment event retained'); END;
 `);
}
