import type { Db } from "./db.js";

export function createRiskReuseTable(db: Db) {
  db.exec(`CREATE TABLE risk_reuse_sources(
    assessment_id TEXT PRIMARY KEY REFERENCES risk_assessments(id),
    site_id TEXT NOT NULL REFERENCES sites(id),
    source_id TEXT NOT NULL REFERENCES risk_assessments(id),
    provenance TEXT NOT NULL,
    provenance_hash TEXT NOT NULL
  );
  CREATE TRIGGER risk_reuse_sources_fixed BEFORE UPDATE ON risk_reuse_sources BEGIN SELECT RAISE(ABORT,'Reuse provenance immutable'); END;
  CREATE TRIGGER risk_reuse_sources_retained BEFORE DELETE ON risk_reuse_sources BEGIN SELECT RAISE(ABORT,'Reuse provenance retained'); END;`);
}

export function migrateRiskReuse(db: Db) { createRiskReuseTable(db); db.exec("PRAGMA user_version=32"); }
