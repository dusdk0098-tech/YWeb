import type { Db } from "./db.js";
export function migrateInspectionSchedules(db: Db) {
  db.exec(`
 CREATE TABLE inspection_tasks (
 id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),template_id TEXT NOT NULL REFERENCES inspection_templates(id),
 template_snapshot TEXT NOT NULL,body TEXT NOT NULL,assignee_id TEXT NOT NULL REFERENCES users(id),
 status TEXT NOT NULL CHECK(status IN ('planned','started','cancelled')),version INTEGER NOT NULL,
 root_inspection_id TEXT UNIQUE REFERENCES inspections(id),created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE INDEX inspection_tasks_site ON inspection_tasks(site_id,status,updated_at,id);
 CREATE TABLE inspection_task_events (
 id INTEGER PRIMARY KEY,task_id TEXT NOT NULL REFERENCES inspection_tasks(id),version INTEGER NOT NULL,event TEXT NOT NULL,
 reason TEXT NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,at TEXT NOT NULL,snapshot TEXT NOT NULL,UNIQUE(task_id,version));
 CREATE TABLE inspection_task_links (
 inspection_id TEXT PRIMARY KEY REFERENCES inspections(id),task_id TEXT NOT NULL REFERENCES inspection_tasks(id),snapshot TEXT NOT NULL);
 CREATE INDEX inspection_task_links_task ON inspection_task_links(task_id,inspection_id);
 CREATE TRIGGER inspection_task_frozen BEFORE UPDATE ON inspection_tasks
 WHEN OLD.status!='planned' OR NEW.id IS NOT OLD.id OR NEW.site_id IS NOT OLD.site_id OR NEW.template_id IS NOT OLD.template_id
 OR NEW.template_snapshot IS NOT OLD.template_snapshot OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
 BEGIN SELECT RAISE(ABORT,'Task origin or terminal state is immutable'); END;
 CREATE TRIGGER inspection_task_no_delete BEFORE DELETE ON inspection_tasks BEGIN SELECT RAISE(ABORT,'Task cannot be deleted'); END;
 CREATE TRIGGER inspection_task_event_no_update BEFORE UPDATE ON inspection_task_events BEGIN SELECT RAISE(ABORT,'Task event immutable'); END;
 CREATE TRIGGER inspection_task_event_no_delete BEFORE DELETE ON inspection_task_events BEGIN SELECT RAISE(ABORT,'Task event immutable'); END;
 CREATE TRIGGER inspection_task_link_no_update BEFORE UPDATE ON inspection_task_links BEGIN SELECT RAISE(ABORT,'Task provenance immutable'); END;
 CREATE TRIGGER inspection_task_link_no_delete BEFORE DELETE ON inspection_task_links BEGIN SELECT RAISE(ABORT,'Task provenance immutable'); END;
 CREATE TRIGGER inspection_task_link_site BEFORE INSERT ON inspection_task_links
 WHEN NOT EXISTS(SELECT 1 FROM inspections i JOIN inspection_tasks t ON t.site_id=i.site_id WHERE i.id=NEW.inspection_id AND t.id=NEW.task_id)
 BEGIN SELECT RAISE(ABORT,'Task provenance site mismatch'); END;
 PRAGMA user_version=11;
 `);
}
