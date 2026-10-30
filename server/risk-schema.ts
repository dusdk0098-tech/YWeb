import type { Db } from "./db.js";
export function migrateRiskCore(db: Db) {
  db.exec(`
 CREATE TABLE risk_criteria(id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),parent_id TEXT UNIQUE REFERENCES risk_criteria(id),version INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN('draft','confirmed')),body TEXT NOT NULL,confirmed_snapshot TEXT,confirmed_hash TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE INDEX risk_criteria_site ON risk_criteria(site_id,created_at,id);
 CREATE TABLE risk_assessments(id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),author_id TEXT NOT NULL REFERENCES users(id),version INTEGER NOT NULL,body TEXT NOT NULL,criteria_id TEXT REFERENCES risk_criteria(id),criteria_snapshot TEXT,criteria_hash TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE INDEX risk_assessments_site ON risk_assessments(site_id,updated_at,id);
 CREATE TABLE risk_events(id INTEGER PRIMARY KEY,site_id TEXT NOT NULL,kind TEXT NOT NULL,record_id TEXT NOT NULL,version INTEGER NOT NULL,event TEXT NOT NULL,reason TEXT NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,at TEXT NOT NULL,snapshot TEXT NOT NULL,UNIQUE(kind,record_id,version));
 CREATE TRIGGER risk_criteria_fixed BEFORE UPDATE ON risk_criteria WHEN OLD.status='confirmed' BEGIN SELECT RAISE(ABORT,'Confirmed criteria immutable'); END;
 CREATE TRIGGER risk_criteria_origin BEFORE UPDATE ON risk_criteria WHEN NEW.id IS NOT OLD.id OR NEW.site_id IS NOT OLD.site_id OR NEW.parent_id IS NOT OLD.parent_id BEGIN SELECT RAISE(ABORT,'Criteria origin immutable'); END;
 CREATE TRIGGER risk_assessment_origin BEFORE UPDATE ON risk_assessments WHEN NEW.id IS NOT OLD.id OR NEW.site_id IS NOT OLD.site_id OR NEW.author_id IS NOT OLD.author_id BEGIN SELECT RAISE(ABORT,'Assessment origin immutable'); END;
 PRAGMA user_version=22;`);
  for (const t of ["risk_criteria", "risk_assessments", "risk_events"])
    db.exec(
      `CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT,'Risk records retained'); END;`,
    );
  db.exec(
    "CREATE TRIGGER risk_events_fixed BEFORE UPDATE ON risk_events BEGIN SELECT RAISE(ABORT,'Risk history immutable'); END;",
  );
}
