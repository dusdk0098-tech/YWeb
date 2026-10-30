import type { Db } from "./db.js";
export function migrateRiskActions(db: Db) {
  db.exec(`
CREATE TABLE risk_actions(id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),assessment_id TEXT NOT NULL REFERENCES risk_assessments(id),hazard_id TEXT NOT NULL,plan_index INTEGER NOT NULL,source TEXT NOT NULL,source_hash TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('assigned','reported','verified')),assignee_id TEXT NOT NULL REFERENCES users(id),due TEXT NOT NULL,version INTEGER NOT NULL,report TEXT,verification TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(assessment_id,hazard_id,plan_index));
CREATE INDEX risk_actions_site ON risk_actions(site_id,status,due,id);
CREATE TABLE risk_action_events(id INTEGER PRIMARY KEY,action_id TEXT NOT NULL REFERENCES risk_actions(id),version INTEGER NOT NULL,event TEXT NOT NULL,reason TEXT NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,at TEXT NOT NULL,snapshot TEXT NOT NULL,UNIQUE(action_id,version));
CREATE TRIGGER risk_action_source_fixed BEFORE UPDATE ON risk_actions WHEN NEW.id IS NOT OLD.id OR NEW.site_id IS NOT OLD.site_id OR NEW.assessment_id IS NOT OLD.assessment_id OR NEW.hazard_id IS NOT OLD.hazard_id OR NEW.plan_index IS NOT OLD.plan_index OR NEW.source IS NOT OLD.source OR NEW.source_hash IS NOT OLD.source_hash OR NEW.created_at IS NOT OLD.created_at BEGIN SELECT RAISE(ABORT,'Action source immutable'); END;
CREATE TRIGGER risk_action_no_delete BEFORE DELETE ON risk_actions BEGIN SELECT RAISE(ABORT,'Action retained'); END;
CREATE TRIGGER risk_action_events_no_update BEFORE UPDATE ON risk_action_events BEGIN SELECT RAISE(ABORT,'Action history immutable'); END;
CREATE TRIGGER risk_action_events_no_delete BEFORE DELETE ON risk_action_events BEGIN SELECT RAISE(ABORT,'Action history immutable'); END;
PRAGMA user_version=24;`);
}
