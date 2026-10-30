import type { Db } from "./db.js";
export function migrateAccountEpoch(db: Db) {
  db.exec(`
CREATE TABLE account_auth(user_id TEXT PRIMARY KEY REFERENCES users(id),epoch INTEGER NOT NULL DEFAULT 1 CHECK(epoch>=1));
INSERT INTO account_auth(user_id,epoch) SELECT id,1 FROM users;
CREATE TRIGGER account_auth_on_user AFTER INSERT ON users BEGIN INSERT INTO account_auth(user_id,epoch) VALUES(NEW.id,1); END;
CREATE TABLE account_events(id INTEGER PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),event TEXT NOT NULL,epoch INTEGER NOT NULL,at TEXT NOT NULL);
CREATE TRIGGER account_events_no_update BEFORE UPDATE ON account_events BEGIN SELECT RAISE(ABORT,'Account events immutable'); END;
CREATE TRIGGER account_events_no_delete BEFORE DELETE ON account_events BEGIN SELECT RAISE(ABORT,'Account events immutable'); END;
DELETE FROM sessions;
PRAGMA user_version=16;`);
}
