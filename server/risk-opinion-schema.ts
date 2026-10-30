import type { Db } from "./db.js";
export function migrateRiskOpinions(db: Db) {
  db.exec(`
CREATE TABLE risk_opinions(id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),assessment_id TEXT NOT NULL REFERENCES risk_assessments(id),author_id TEXT NOT NULL REFERENCES users(id),hazard_id TEXT,source TEXT NOT NULL,source_hash TEXT NOT NULL,original TEXT NOT NULL,original_hash TEXT NOT NULL,current_text TEXT NOT NULL,version INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN('open','responded')),response TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX risk_opinion_scope ON risk_opinions(site_id,author_id,updated_at,id);
CREATE TABLE risk_opinion_events(id INTEGER PRIMARY KEY,opinion_id TEXT NOT NULL REFERENCES risk_opinions(id),version INTEGER NOT NULL,event TEXT NOT NULL,reason TEXT NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,at TEXT NOT NULL,snapshot TEXT NOT NULL,UNIQUE(opinion_id,version));
CREATE TRIGGER risk_opinion_source_fixed BEFORE UPDATE ON risk_opinions WHEN NEW.id IS NOT OLD.id OR NEW.site_id IS NOT OLD.site_id OR NEW.assessment_id IS NOT OLD.assessment_id OR NEW.author_id IS NOT OLD.author_id OR NEW.hazard_id IS NOT OLD.hazard_id OR NEW.source IS NOT OLD.source OR NEW.source_hash IS NOT OLD.source_hash OR NEW.original IS NOT OLD.original OR NEW.original_hash IS NOT OLD.original_hash OR NEW.created_at IS NOT OLD.created_at BEGIN SELECT RAISE(ABORT,'Opinion source/original immutable'); END;
CREATE TRIGGER risk_opinion_no_delete BEFORE DELETE ON risk_opinions BEGIN SELECT RAISE(ABORT,'Opinion retained'); END;
CREATE TRIGGER risk_opinion_events_no_update BEFORE UPDATE ON risk_opinion_events BEGIN SELECT RAISE(ABORT,'Opinion history immutable'); END;
CREATE TRIGGER risk_opinion_events_no_delete BEFORE DELETE ON risk_opinion_events BEGIN SELECT RAISE(ABORT,'Opinion history retained'); END;
PRAGMA user_version=26;`);
}
