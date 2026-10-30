import type { Db } from "./db.js";
export function migrateDailyJournals(db: Db) {
  db.exec(`
 CREATE TABLE daily_journals (
 id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),date TEXT NOT NULL,body TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','archived')),version INTEGER NOT NULL,
 author_id TEXT NOT NULL REFERENCES users(id),parent_id TEXT UNIQUE REFERENCES daily_journals(id),revision_reason TEXT NOT NULL,
 source_capture TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE UNIQUE INDEX daily_root_day ON daily_journals(site_id,date) WHERE parent_id IS NULL;
 CREATE INDEX daily_site_day ON daily_journals(site_id,date,created_at,id);
 CREATE TABLE daily_journal_snapshots(journal_id TEXT PRIMARY KEY REFERENCES daily_journals(id),body TEXT NOT NULL,hash TEXT NOT NULL);
 CREATE TABLE daily_journal_events(id INTEGER PRIMARY KEY,journal_id TEXT NOT NULL REFERENCES daily_journals(id),version INTEGER NOT NULL,event TEXT NOT NULL,
 actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,at TEXT NOT NULL,note TEXT NOT NULL,UNIQUE(journal_id,version));
 CREATE TRIGGER daily_frozen BEFORE UPDATE ON daily_journals
 WHEN OLD.status='archived' OR NEW.id IS NOT OLD.id OR NEW.site_id IS NOT OLD.site_id OR NEW.date IS NOT OLD.date
 OR NEW.author_id IS NOT OLD.author_id OR NEW.parent_id IS NOT OLD.parent_id OR NEW.revision_reason IS NOT OLD.revision_reason OR NEW.created_at IS NOT OLD.created_at
 BEGIN SELECT RAISE(ABORT,'Daily journal origin or archived body immutable'); END;
 CREATE TRIGGER daily_revision_site_date BEFORE INSERT ON daily_journals WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM daily_journals WHERE id=NEW.parent_id AND site_id=NEW.site_id AND date=NEW.date AND status='archived')
 BEGIN SELECT RAISE(ABORT,'Revision must preserve archived site/date'); END;
 CREATE TRIGGER daily_no_delete BEFORE DELETE ON daily_journals BEGIN SELECT RAISE(ABORT,'Daily journal cannot be deleted'); END;
 CREATE TRIGGER daily_snapshot_no_update BEFORE UPDATE ON daily_journal_snapshots BEGIN SELECT RAISE(ABORT,'Daily snapshot immutable'); END;
 CREATE TRIGGER daily_snapshot_no_delete BEFORE DELETE ON daily_journal_snapshots BEGIN SELECT RAISE(ABORT,'Daily snapshot immutable'); END;
 CREATE TRIGGER daily_event_no_update BEFORE UPDATE ON daily_journal_events BEGIN SELECT RAISE(ABORT,'Daily event immutable'); END;
 CREATE TRIGGER daily_event_no_delete BEFORE DELETE ON daily_journal_events BEGIN SELECT RAISE(ABORT,'Daily event immutable'); END;
 PRAGMA user_version=12;
`);
}
