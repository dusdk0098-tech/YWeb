import type { Db } from "./db.js";
/** Schema31 adds publication evidence without rewriting existing assessment data. */
export function migrateRiskPublications(db: Db) {
  db.exec(`
CREATE TABLE risk_publications(id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),assessment_id TEXT NOT NULL REFERENCES risk_assessments(id),submission_version INTEGER NOT NULL,submission_hash TEXT NOT NULL,snapshot TEXT NOT NULL,snapshot_hash TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('published','withdrawn')),version INTEGER NOT NULL,created_at TEXT NOT NULL,withdrawn_at TEXT,withdraw_reason TEXT);
CREATE UNIQUE INDEX risk_publication_active ON risk_publications(assessment_id) WHERE status='published';
CREATE INDEX risk_publication_site ON risk_publications(site_id,created_at,id);
CREATE TABLE risk_publication_targets(publication_id TEXT NOT NULL REFERENCES risk_publications(id),user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,PRIMARY KEY(publication_id,user_id));
CREATE TABLE risk_publication_acks(id TEXT PRIMARY KEY,publication_id TEXT NOT NULL REFERENCES risk_publications(id),user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,at TEXT NOT NULL,submission_hash TEXT NOT NULL,publication_hash TEXT NOT NULL,statement TEXT NOT NULL,UNIQUE(publication_id,user_id));
CREATE TABLE risk_publication_events(id INTEGER PRIMARY KEY,publication_id TEXT NOT NULL REFERENCES risk_publications(id),version INTEGER NOT NULL,event TEXT NOT NULL,actor_id TEXT NOT NULL,name TEXT NOT NULL,at TEXT NOT NULL,reason TEXT NOT NULL,UNIQUE(publication_id,version));
CREATE TRIGGER risk_publication_origin_fixed BEFORE UPDATE ON risk_publications WHEN NEW.id IS NOT OLD.id OR NEW.site_id IS NOT OLD.site_id OR NEW.assessment_id IS NOT OLD.assessment_id OR NEW.submission_version IS NOT OLD.submission_version OR NEW.submission_hash IS NOT OLD.submission_hash OR NEW.snapshot IS NOT OLD.snapshot OR NEW.snapshot_hash IS NOT OLD.snapshot_hash OR NEW.created_at IS NOT OLD.created_at BEGIN SELECT RAISE(ABORT,'Risk publication origin immutable'); END;
CREATE TRIGGER risk_publication_withdraw_only BEFORE UPDATE ON risk_publications WHEN OLD.status!='published' OR NEW.status!='withdrawn' OR NEW.version!=OLD.version+1 OR NEW.withdrawn_at IS NULL OR NEW.withdraw_reason IS NULL BEGIN SELECT RAISE(ABORT,'Risk publication withdrawal only'); END;
CREATE TRIGGER risk_publication_no_delete BEFORE DELETE ON risk_publications BEGIN SELECT RAISE(ABORT,'Risk publication retained'); END;
CREATE TRIGGER risk_publication_target_matches BEFORE INSERT ON risk_publication_targets WHEN NOT EXISTS(SELECT 1 FROM risk_publications p,json_each(p.snapshot,'$.targets') t WHERE p.id=NEW.publication_id AND json_extract(t.value,'$.userId')=NEW.user_id AND json_extract(t.value,'$.name')=NEW.name) BEGIN SELECT RAISE(ABORT,'Target must match immutable publication'); END;
`);
  for (const table of ["risk_publication_targets", "risk_publication_acks", "risk_publication_events"]) {
    db.exec(`CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Risk publication evidence immutable'); END;`);
    db.exec(`CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Risk publication evidence retained'); END;`);
  }
  db.exec("PRAGMA user_version=31");
}
