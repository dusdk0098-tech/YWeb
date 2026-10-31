import type { Db } from "./db.js";
// IF NOT EXISTS: older-schema test fixtures drop only the tables they know about.
// One settings row per cost period; editable only while that period is open (closures keep their own copy).
export function migrateCostSettings(db: Db) {
  db.exec(`
 CREATE TABLE IF NOT EXISTS cost_period_settings(period_id TEXT PRIMARY KEY REFERENCES cost_periods(id),body TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS cost_settings_open_insert BEFORE INSERT ON cost_period_settings WHEN NOT EXISTS(SELECT 1 FROM cost_periods WHERE id=NEW.period_id AND status='open')
 BEGIN SELECT RAISE(ABORT,'Cost settings require open period'); END;
 CREATE TRIGGER IF NOT EXISTS cost_settings_open_update BEFORE UPDATE ON cost_period_settings WHEN NEW.period_id IS NOT OLD.period_id OR NOT EXISTS(SELECT 1 FROM cost_periods WHERE id=OLD.period_id AND status='open')
 BEGIN SELECT RAISE(ABORT,'Cost settings require open period'); END;
 CREATE TRIGGER IF NOT EXISTS cost_settings_no_delete BEFORE DELETE ON cost_period_settings BEGIN SELECT RAISE(ABORT,'Cost settings cannot be deleted'); END;
 PRAGMA user_version=57;
`);
}
