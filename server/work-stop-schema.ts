import type { Db } from "./db.js";
export function migrateWorkStops(db: Db) {
  db.exec(`CREATE TABLE work_stops (
 id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),requester_id TEXT NOT NULL REFERENCES users(id),
 original TEXT NOT NULL,original_hash TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('requested','acknowledged','stop_recorded','review_requested','resumption_recorded','closed_without_stop_record')),
 version INTEGER NOT NULL,assignee_id TEXT REFERENCES users(id),stop_record TEXT,review_record TEXT,resumption_record TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE INDEX work_stops_site ON work_stops(site_id,updated_at,id);
 CREATE TABLE work_stop_events(id INTEGER PRIMARY KEY,record_id TEXT NOT NULL REFERENCES work_stops(id),version INTEGER NOT NULL,event TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at TEXT NOT NULL,note TEXT NOT NULL,snapshot TEXT NOT NULL,UNIQUE(record_id,version));
 CREATE TRIGGER work_stop_original_immutable BEFORE UPDATE ON work_stops WHEN NEW.original IS NOT OLD.original OR NEW.original_hash IS NOT OLD.original_hash OR NEW.requester_id IS NOT OLD.requester_id OR NEW.site_id IS NOT OLD.site_id OR NEW.id IS NOT OLD.id BEGIN SELECT RAISE(ABORT,'Work-stop original is immutable'); END;
 CREATE TRIGGER work_stop_no_delete BEFORE DELETE ON work_stops BEGIN SELECT RAISE(ABORT,'Work-stop record retained'); END;
 CREATE TRIGGER work_stop_event_no_update BEFORE UPDATE ON work_stop_events BEGIN SELECT RAISE(ABORT,'Work-stop event immutable'); END;
 CREATE TRIGGER work_stop_event_no_delete BEFORE DELETE ON work_stop_events BEGIN SELECT RAISE(ABORT,'Work-stop event immutable'); END;
 CREATE TRIGGER work_stop_terminal_immutable BEFORE UPDATE ON work_stops WHEN OLD.status IN('resumption_recorded','closed_without_stop_record') AND (NEW.status IS NOT OLD.status OR NEW.assignee_id IS NOT OLD.assignee_id OR NEW.stop_record IS NOT OLD.stop_record OR NEW.review_record IS NOT OLD.review_record OR NEW.resumption_record IS NOT OLD.resumption_record) BEGIN SELECT RAISE(ABORT,'Terminal work-stop fields immutable'); END;
 PRAGMA user_version=20;`);
}
