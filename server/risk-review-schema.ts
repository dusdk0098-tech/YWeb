import type { Db } from "./db.js";
export function migrateRiskReview(db: Db) {
  db.exec(`
ALTER TABLE risk_assessments ADD COLUMN status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','submitted','accepted','returned'));
ALTER TABLE risk_assessments ADD COLUMN parent_id TEXT REFERENCES risk_assessments(id);
ALTER TABLE risk_assessments ADD COLUMN successor_id TEXT REFERENCES risk_assessments(id);
ALTER TABLE risk_assessments ADD COLUMN submission TEXT;
ALTER TABLE risk_assessments ADD COLUMN submission_hash TEXT;
ALTER TABLE risk_assessments ADD COLUMN decision TEXT;
CREATE UNIQUE INDEX risk_assessment_parent ON risk_assessments(parent_id) WHERE parent_id IS NOT NULL;
CREATE TRIGGER risk_assessment_parent_fixed BEFORE UPDATE ON risk_assessments WHEN NEW.parent_id IS NOT OLD.parent_id OR (OLD.successor_id IS NOT NULL AND NEW.successor_id IS NOT OLD.successor_id) BEGIN SELECT RAISE(ABORT,'Risk revision link immutable'); END;
CREATE TRIGGER risk_assessment_submission_fixed BEFORE UPDATE ON risk_assessments WHEN (OLD.submission IS NOT NULL AND (NEW.submission IS NOT OLD.submission OR NEW.submission_hash IS NOT OLD.submission_hash)) OR (OLD.status!='draft' AND (NEW.body IS NOT OLD.body OR NEW.criteria_id IS NOT OLD.criteria_id OR NEW.criteria_snapshot IS NOT OLD.criteria_snapshot OR NEW.criteria_hash IS NOT OLD.criteria_hash)) OR (OLD.decision IS NOT NULL AND NEW.decision IS NOT OLD.decision) BEGIN SELECT RAISE(ABORT,'Submitted risk content/decision immutable'); END;
PRAGMA user_version=23;`);
}
