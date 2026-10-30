import type { Db } from "./db.js";
// Set the actual next user_version only in the integrating migration after Phase46.
export function createMinutesRecordTables(db: Db) {
 db.exec(`
 CREATE TABLE minutes_records(minutes_id TEXT PRIMARY KEY REFERENCES minutes(id),status TEXT NOT NULL CHECK(status IN('draft','finalized')),parent_id TEXT UNIQUE REFERENCES minutes(id),revision_reason TEXT NOT NULL);
 CREATE TRIGGER minutes_record_final_fixed BEFORE UPDATE ON minutes_records WHEN OLD.status='finalized' BEGIN SELECT RAISE(ABORT,'Final minutes state immutable'); END;
 CREATE TRIGGER minutes_record_retained BEFORE DELETE ON minutes_records BEGIN SELECT RAISE(ABORT,'Minutes state retained'); END;
 CREATE TABLE minutes_snapshots(minutes_id TEXT PRIMARY KEY REFERENCES minutes(id),body TEXT NOT NULL,hash TEXT NOT NULL);
 CREATE TRIGGER minutes_final_fixed BEFORE UPDATE ON minutes WHEN EXISTS(SELECT 1 FROM minutes_records WHERE minutes_id=OLD.id AND status='finalized') BEGIN SELECT RAISE(ABORT,'Final minutes immutable'); END;
 CREATE TRIGGER minutes_final_retained BEFORE DELETE ON minutes WHEN EXISTS(SELECT 1 FROM minutes_records WHERE minutes_id=OLD.id AND status='finalized') BEGIN SELECT RAISE(ABORT,'Final minutes retained'); END;
 CREATE TRIGGER minutes_snapshot_no_update BEFORE UPDATE ON minutes_snapshots BEGIN SELECT RAISE(ABORT,'Minutes snapshot immutable'); END;
 CREATE TRIGGER minutes_snapshot_no_delete BEFORE DELETE ON minutes_snapshots BEGIN SELECT RAISE(ABORT,'Minutes snapshot retained'); END;
 CREATE TABLE minutes_followups(
 id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),minutes_id TEXT NOT NULL REFERENCES minutes(id),action_index INTEGER NOT NULL,
 source TEXT NOT NULL,source_hash TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('assigned','reported','verified')),
 assignee_id TEXT NOT NULL REFERENCES users(id),due TEXT NOT NULL,version INTEGER NOT NULL,report TEXT,verification TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 UNIQUE(minutes_id,action_index));
 CREATE INDEX minutes_followups_site ON minutes_followups(site_id,status,due,id);
 CREATE TABLE minutes_followup_events(id INTEGER PRIMARY KEY,followup_id TEXT NOT NULL REFERENCES minutes_followups(id),version INTEGER NOT NULL,event TEXT NOT NULL,reason TEXT NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,at TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(followup_id,version));
 CREATE TRIGGER minutes_followup_source_fixed BEFORE UPDATE ON minutes_followups WHEN NEW.id IS NOT OLD.id OR NEW.site_id IS NOT OLD.site_id OR NEW.minutes_id IS NOT OLD.minutes_id OR NEW.action_index IS NOT OLD.action_index OR NEW.source IS NOT OLD.source OR NEW.source_hash IS NOT OLD.source_hash OR NEW.created_at IS NOT OLD.created_at BEGIN SELECT RAISE(ABORT,'Minutes followup source immutable'); END;
 CREATE TRIGGER minutes_followup_retained BEFORE DELETE ON minutes_followups BEGIN SELECT RAISE(ABORT,'Minutes followup retained'); END;
 CREATE TRIGGER minutes_followup_event_fixed BEFORE UPDATE ON minutes_followup_events BEGIN SELECT RAISE(ABORT,'Minutes followup event immutable'); END;
 CREATE TRIGGER minutes_followup_event_retained BEFORE DELETE ON minutes_followup_events BEGIN SELECT RAISE(ABORT,'Minutes followup event retained'); END;
 `);
}

export function migrateMinutesRecords(db:Db){createMinutesRecordTables(db);db.exec("PRAGMA user_version=34");}
