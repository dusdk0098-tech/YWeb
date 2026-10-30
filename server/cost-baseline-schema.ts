import type { Db } from "./db.js";
// Additive records; legacy closure bytes and status remain unchanged.
export function migrateCostBaselines(db: Db) {
  db.exec(`
    PRAGMA user_version=38;
    CREATE TABLE cost_baselines(
      id TEXT PRIMARY KEY,period_id TEXT NOT NULL REFERENCES cost_periods(id),
      closure_id TEXT NOT NULL UNIQUE REFERENCES cost_closures(id),
      body TEXT NOT NULL,hash TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX cost_baseline_period ON cost_baselines(period_id,created_at,id);
    CREATE TABLE cost_baseline_statements(
      id TEXT PRIMARY KEY,baseline_id TEXT NOT NULL REFERENCES cost_baselines(id),
      number INTEGER NOT NULL,corrects_id TEXT REFERENCES cost_baseline_statements(id),
      body TEXT NOT NULL,hash TEXT NOT NULL,created_at TEXT NOT NULL,
      UNIQUE(baseline_id,number));
    CREATE TRIGGER cost_baseline_same_period BEFORE INSERT ON cost_baselines
      WHEN NOT EXISTS(SELECT 1 FROM cost_closures WHERE id=NEW.closure_id AND period_id=NEW.period_id)
      BEGIN SELECT RAISE(ABORT,'Baseline closure period mismatch'); END;
    CREATE TRIGGER cost_statement_same_baseline BEFORE INSERT ON cost_baseline_statements
      WHEN NEW.corrects_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM cost_baseline_statements WHERE id=NEW.corrects_id AND baseline_id=NEW.baseline_id)
      BEGIN SELECT RAISE(ABORT,'Statement correction baseline mismatch'); END;
    CREATE TRIGGER cost_baseline_no_update BEFORE UPDATE ON cost_baselines BEGIN SELECT RAISE(ABORT,'Baseline immutable'); END;
    CREATE TRIGGER cost_baseline_no_delete BEFORE DELETE ON cost_baselines BEGIN SELECT RAISE(ABORT,'Baseline immutable'); END;
    CREATE TRIGGER cost_statement_no_update BEFORE UPDATE ON cost_baseline_statements BEGIN SELECT RAISE(ABORT,'Statement immutable'); END;
    CREATE TRIGGER cost_statement_no_delete BEFORE DELETE ON cost_baseline_statements BEGIN SELECT RAISE(ABORT,'Statement immutable'); END;
  `);
}
