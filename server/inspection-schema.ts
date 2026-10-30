import type { Db } from "./db.js";
export function migrateInspections(db: Db) {
  db.exec(`
    CREATE TABLE inspection_templates (
      id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id), parent_id TEXT UNIQUE REFERENCES inspection_templates(id),
      body TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','published')), version INTEGER NOT NULL,
      published_snapshot TEXT, created_at TEXT NOT NULL);
    CREATE INDEX inspection_templates_site ON inspection_templates(site_id,created_at,id);
    CREATE TABLE inspections (
      id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id), template_id TEXT NOT NULL REFERENCES inspection_templates(id),
      template_snapshot TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id), parent_id TEXT UNIQUE REFERENCES inspections(id),
      body TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','submitted','accepted','returned')), version INTEGER NOT NULL,
      submitted_snapshot TEXT, review TEXT, created_at TEXT NOT NULL);
    CREATE INDEX inspections_site ON inspections(site_id,created_at,id);
    CREATE TABLE inspection_events (
      id INTEGER PRIMARY KEY, inspection_id TEXT NOT NULL REFERENCES inspections(id), version INTEGER NOT NULL,
      event TEXT NOT NULL, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, at TEXT NOT NULL, note TEXT NOT NULL,
      UNIQUE(inspection_id,version));
    CREATE TRIGGER inspection_template_frozen BEFORE UPDATE ON inspection_templates WHEN OLD.status='published'
      BEGIN SELECT RAISE(ABORT,'Published template is immutable'); END;
    CREATE TRIGGER inspection_template_no_delete BEFORE DELETE ON inspection_templates
      BEGIN SELECT RAISE(ABORT,'Template cannot be deleted'); END;
    CREATE TRIGGER inspection_snapshot_frozen BEFORE UPDATE ON inspections
      WHEN (OLD.submitted_snapshot IS NOT NULL AND (NEW.submitted_snapshot IS NOT OLD.submitted_snapshot OR NEW.body != OLD.body))
        OR NEW.template_snapshot != OLD.template_snapshot OR NEW.template_id != OLD.template_id OR NEW.owner_id != OLD.owner_id
      BEGIN SELECT RAISE(ABORT,'Inspection original is immutable'); END;
    CREATE TRIGGER inspection_no_delete BEFORE DELETE ON inspections BEGIN SELECT RAISE(ABORT,'Inspection cannot be deleted'); END;
    CREATE TRIGGER inspection_event_no_update BEFORE UPDATE ON inspection_events BEGIN SELECT RAISE(ABORT,'Event is immutable'); END;
    CREATE TRIGGER inspection_event_no_delete BEFORE DELETE ON inspection_events BEGIN SELECT RAISE(ABORT,'Event is immutable'); END;
    PRAGMA user_version=5;
  `);
}
