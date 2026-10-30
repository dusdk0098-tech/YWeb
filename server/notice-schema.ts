import type { Db } from "./db.js";
export function migrateNotices(db: Db) {
  db.exec(`
CREATE TABLE notices(id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),parent_id TEXT UNIQUE REFERENCES notices(id),body TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('draft','published','withdrawn','superseded')),version INTEGER NOT NULL DEFAULT 1,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX notices_site ON notices(site_id,created_at,id);
CREATE TABLE notice_targets(notice_id TEXT NOT NULL REFERENCES notices(id),user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,PRIMARY KEY(notice_id,user_id));
CREATE TABLE notice_snapshots(notice_id TEXT PRIMARY KEY REFERENCES notices(id),body TEXT NOT NULL);
CREATE TABLE notice_acknowledgements(id TEXT PRIMARY KEY,notice_id TEXT NOT NULL REFERENCES notices(id),user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,at TEXT NOT NULL,published_version INTEGER NOT NULL,UNIQUE(notice_id,user_id));
CREATE TABLE notice_events(id INTEGER PRIMARY KEY,notice_id TEXT NOT NULL REFERENCES notices(id),version INTEGER NOT NULL,event TEXT NOT NULL,actor_id TEXT NOT NULL,name TEXT NOT NULL,at TEXT NOT NULL,reason TEXT NOT NULL,UNIQUE(notice_id,version));
CREATE TRIGGER notice_content_frozen BEFORE UPDATE ON notices WHEN OLD.status!='draft' AND (NEW.body!=OLD.body OR NEW.parent_id IS NOT OLD.parent_id OR NEW.site_id!=OLD.site_id) BEGIN SELECT RAISE(ABORT,'Published notice content is immutable'); END;
CREATE TRIGGER notice_no_delete BEFORE DELETE ON notices BEGIN SELECT RAISE(ABORT,'Notice cannot be deleted'); END;
CREATE TRIGGER notice_snapshot_no_update BEFORE UPDATE ON notice_snapshots BEGIN SELECT RAISE(ABORT,'Notice snapshot is immutable'); END;
CREATE TRIGGER notice_snapshot_no_delete BEFORE DELETE ON notice_snapshots BEGIN SELECT RAISE(ABORT,'Notice snapshot is immutable'); END;
CREATE TRIGGER notice_target_no_update BEFORE UPDATE ON notice_targets WHEN EXISTS(SELECT 1 FROM notices WHERE id=OLD.notice_id AND status!='draft') BEGIN SELECT RAISE(ABORT,'Notice target is immutable'); END;
CREATE TRIGGER notice_target_no_delete BEFORE DELETE ON notice_targets WHEN EXISTS(SELECT 1 FROM notices WHERE id=OLD.notice_id AND status!='draft') BEGIN SELECT RAISE(ABORT,'Notice target is immutable'); END;
CREATE TRIGGER notice_target_no_insert BEFORE INSERT ON notice_targets WHEN EXISTS(SELECT 1 FROM notices WHERE id=NEW.notice_id AND status!='draft') BEGIN SELECT RAISE(ABORT,'Notice target is immutable'); END;
CREATE TRIGGER notice_ack_no_update BEFORE UPDATE ON notice_acknowledgements BEGIN SELECT RAISE(ABORT,'Acknowledgement is immutable'); END;
CREATE TRIGGER notice_ack_no_delete BEFORE DELETE ON notice_acknowledgements BEGIN SELECT RAISE(ABORT,'Acknowledgement is immutable'); END;
CREATE TRIGGER notice_event_no_update BEFORE UPDATE ON notice_events BEGIN SELECT RAISE(ABORT,'Notice event is immutable'); END;
CREATE TRIGGER notice_event_no_delete BEFORE DELETE ON notice_events BEGIN SELECT RAISE(ABORT,'Notice event is immutable'); END;
PRAGMA user_version=8;
`);
}
