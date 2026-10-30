import type { Db } from "./db.js";
export function migrateWorkPlans(db: Db) {
  db.exec(`
CREATE TABLE work_plans(id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),body TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('draft','archived')),version INTEGER NOT NULL,author_id TEXT NOT NULL REFERENCES users(id),parent_id TEXT UNIQUE REFERENCES work_plans(id),revision_reason TEXT NOT NULL,source_capture TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX work_plans_site ON work_plans(site_id,created_at,id);
CREATE TABLE work_plan_snapshots(plan_id TEXT PRIMARY KEY REFERENCES work_plans(id),body TEXT NOT NULL,hash TEXT NOT NULL);
CREATE TABLE work_plan_events(id INTEGER PRIMARY KEY,plan_id TEXT NOT NULL REFERENCES work_plans(id),version INTEGER NOT NULL,event TEXT NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,at TEXT NOT NULL,note TEXT NOT NULL,UNIQUE(plan_id,version));
CREATE TRIGGER work_plan_frozen BEFORE UPDATE ON work_plans WHEN OLD.status='archived' OR NEW.id IS NOT OLD.id OR NEW.site_id IS NOT OLD.site_id OR NEW.author_id IS NOT OLD.author_id OR NEW.parent_id IS NOT OLD.parent_id OR NEW.revision_reason IS NOT OLD.revision_reason OR NEW.created_at IS NOT OLD.created_at BEGIN SELECT RAISE(ABORT,'Work plan origin/archived immutable'); END;
CREATE TRIGGER work_plan_parent BEFORE INSERT ON work_plans WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM work_plans WHERE id=NEW.parent_id AND site_id=NEW.site_id AND status='archived') BEGIN SELECT RAISE(ABORT,'Work plan parent must be archived in site'); END;
CREATE TRIGGER work_plan_no_delete BEFORE DELETE ON work_plans BEGIN SELECT RAISE(ABORT,'Work plan cannot be deleted'); END;
CREATE TRIGGER work_plan_snapshot_no_update BEFORE UPDATE ON work_plan_snapshots BEGIN SELECT RAISE(ABORT,'Work plan snapshot immutable'); END;
CREATE TRIGGER work_plan_snapshot_no_delete BEFORE DELETE ON work_plan_snapshots BEGIN SELECT RAISE(ABORT,'Work plan snapshot immutable'); END;
CREATE TRIGGER work_plan_event_no_update BEFORE UPDATE ON work_plan_events BEGIN SELECT RAISE(ABORT,'Work plan events immutable'); END;
CREATE TRIGGER work_plan_event_no_delete BEFORE DELETE ON work_plan_events BEGIN SELECT RAISE(ABORT,'Work plan events immutable'); END;
PRAGMA user_version=17;`);
}
