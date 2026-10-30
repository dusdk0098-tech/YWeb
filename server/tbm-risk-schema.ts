import type { Db } from "./db.js";
export function createTbmRiskReferenceTable(db: Db) {
  db.exec(`
    CREATE TABLE tbm_risk_references (
      session_id TEXT PRIMARY KEY REFERENCES tbm_sessions(id),
      assessment_id TEXT NOT NULL REFERENCES risk_assessments(id),
      submission_version INTEGER NOT NULL,
      submission_hash TEXT NOT NULL,
      body TEXT NOT NULL
    );
    CREATE TRIGGER tbm_risk_ref_insert BEFORE INSERT ON tbm_risk_references
      WHEN NOT EXISTS(SELECT 1 FROM tbm_sessions WHERE id=NEW.session_id AND status='draft')
      BEGIN SELECT RAISE(ABORT,'TBM reference requires draft'); END;
    CREATE TRIGGER tbm_risk_ref_update BEFORE UPDATE ON tbm_risk_references
      BEGIN SELECT RAISE(ABORT,'Replace draft TBM reference explicitly'); END;
    CREATE TRIGGER tbm_risk_ref_delete BEFORE DELETE ON tbm_risk_references
      WHEN NOT EXISTS(SELECT 1 FROM tbm_sessions WHERE id=OLD.session_id AND status='draft')
      BEGIN SELECT RAISE(ABORT,'Finalized TBM reference is immutable'); END;
  `);
}

export function migrateTbmRiskReferences(db: Db) {
  createTbmRiskReferenceTable(db);
  db.exec("PRAGMA user_version=33");
}
