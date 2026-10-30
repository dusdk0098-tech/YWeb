import type { Db } from "./db.js";
export function migrateRiskResiduals(db: Db) {
  db.exec(`
CREATE TABLE risk_residuals(id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),assessment_id TEXT NOT NULL REFERENCES risk_assessments(id),hazard_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('projected','after_confirmation')),version INTEGER NOT NULL,snapshot TEXT NOT NULL,snapshot_hash TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(assessment_id,hazard_id,kind,version));
CREATE INDEX risk_residual_scope ON risk_residuals(site_id,assessment_id,hazard_id,kind,version);
CREATE TRIGGER risk_residual_no_update BEFORE UPDATE ON risk_residuals BEGIN SELECT RAISE(ABORT,'Residual record immutable'); END;
CREATE TRIGGER risk_residual_no_delete BEFORE DELETE ON risk_residuals BEGIN SELECT RAISE(ABORT,'Residual record retained'); END;
PRAGMA user_version=25;`);
}

/** New nonnumeric residual JSON fence; no stored record is rewritten. */
export function migrateRiskResidualMethods(db: Db) {
  db.exec("PRAGMA user_version=29");
}

/** Checklist/narrative residual JSON capability fence; immutable old rows are untouched. */
export function migrateRiskResidualHumanMethods(db: Db) { db.exec("PRAGMA user_version=45"); }
