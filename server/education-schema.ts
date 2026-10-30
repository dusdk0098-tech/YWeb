import type { Db } from "./db.js";
export function migrateEducation(db: Db) {
  db.exec(`
CREATE TABLE education_sessions (
 id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),body TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('draft','archived')),
 version INTEGER NOT NULL DEFAULT 1,parent_id TEXT UNIQUE REFERENCES education_sessions(id),revision_reason TEXT NOT NULL,
 author_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX education_site ON education_sessions(site_id,created_at,id);
CREATE TABLE education_participants (
 session_id TEXT NOT NULL REFERENCES education_sessions(id),worker_id TEXT NOT NULL REFERENCES workers(id),name TEXT NOT NULL,affiliation TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('worker','visitor')),state TEXT NOT NULL CHECK(state IN ('pending','attended','absent')),
 attended_minutes INTEGER NOT NULL DEFAULT 0 CHECK(attended_minutes>=0),recorded_by TEXT REFERENCES users(id),recorded_at TEXT,
 PRIMARY KEY(session_id,worker_id));
CREATE TABLE education_snapshots (
 session_id TEXT PRIMARY KEY REFERENCES education_sessions(id),body TEXT NOT NULL,hash TEXT NOT NULL,
 archived_by TEXT NOT NULL REFERENCES users(id),archived_at TEXT NOT NULL);
CREATE TRIGGER education_snapshot_no_update BEFORE UPDATE ON education_snapshots BEGIN SELECT RAISE(ABORT,'Education snapshot is immutable'); END;
CREATE TRIGGER education_snapshot_no_delete BEFORE DELETE ON education_snapshots BEGIN SELECT RAISE(ABORT,'Education snapshot is immutable'); END;
CREATE TRIGGER education_archived_no_update BEFORE UPDATE ON education_sessions WHEN OLD.status='archived' BEGIN SELECT RAISE(ABORT,'Archived journal is immutable'); END;
CREATE TRIGGER education_no_delete BEFORE DELETE ON education_sessions BEGIN SELECT RAISE(ABORT,'Journal cannot be deleted'); END;
CREATE TRIGGER education_participant_frozen_update BEFORE UPDATE ON education_participants WHEN EXISTS(SELECT 1 FROM education_sessions WHERE id=OLD.session_id AND status='archived') BEGIN SELECT RAISE(ABORT,'Archived participation is immutable'); END;
CREATE TRIGGER education_participant_frozen_delete BEFORE DELETE ON education_participants WHEN EXISTS(SELECT 1 FROM education_sessions WHERE id=OLD.session_id AND status='archived') BEGIN SELECT RAISE(ABORT,'Archived participation is immutable'); END;
CREATE TRIGGER education_participant_frozen_insert BEFORE INSERT ON education_participants WHEN EXISTS(SELECT 1 FROM education_sessions WHERE id=NEW.session_id AND status='archived') BEGIN SELECT RAISE(ABORT,'Archived participation is immutable'); END;
PRAGMA user_version=7;
`);
}
