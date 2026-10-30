import type { Db } from "./db.js";
// Additive defaults/provenance only; historical ledger bytes are not rewritten.
export function migrateCostPresets(db:Db){db.exec(`
 PRAGMA user_version=47;
 CREATE TABLE cost_input_presets(
  id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),root_id TEXT NOT NULL REFERENCES cost_input_presets(id),
  parent_id TEXT UNIQUE REFERENCES cost_input_presets(id),version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 1001),
  status TEXT NOT NULL CHECK(status IN('active','retired')),body TEXT NOT NULL,hash TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(root_id,version));
 CREATE INDEX cost_input_preset_site ON cost_input_presets(site_id,created_at,id);
 CREATE TRIGGER cost_input_preset_parent BEFORE INSERT ON cost_input_presets WHEN
  (NEW.version=1 AND (NEW.parent_id IS NOT NULL OR NEW.root_id<>NEW.id OR NEW.status<>'active')) OR
  (NEW.version>1 AND NOT EXISTS(SELECT 1 FROM cost_input_presets p WHERE p.id=NEW.parent_id AND p.site_id=NEW.site_id AND p.root_id=NEW.root_id AND p.version=NEW.version-1 AND p.status='active'))
 BEGIN SELECT RAISE(ABORT,'Preset predecessor mismatch'); END;
 CREATE TRIGGER cost_input_preset_fixed BEFORE UPDATE ON cost_input_presets BEGIN SELECT RAISE(ABORT,'Preset version immutable'); END;
 CREATE TRIGGER cost_input_preset_retained BEFORE DELETE ON cost_input_presets BEGIN SELECT RAISE(ABORT,'Preset history retained'); END;
 CREATE TABLE cost_expense_preset_sources(expense_id TEXT PRIMARY KEY REFERENCES cost_expenses(id),site_id TEXT NOT NULL REFERENCES sites(id),period_id TEXT NOT NULL REFERENCES cost_periods(id),preset_id TEXT NOT NULL REFERENCES cost_input_presets(id),body TEXT NOT NULL,hash TEXT NOT NULL);
 CREATE TRIGGER cost_preset_source_scope BEFORE INSERT ON cost_expense_preset_sources WHEN NOT EXISTS(
  SELECT 1 FROM cost_expenses e JOIN cost_periods p ON p.id=e.period_id JOIN cost_input_presets t ON t.id=NEW.preset_id AND t.site_id=p.site_id WHERE e.id=NEW.expense_id AND p.id=NEW.period_id AND p.site_id=NEW.site_id)
 BEGIN SELECT RAISE(ABORT,'Preset source scope mismatch'); END;
 CREATE TRIGGER cost_preset_source_fixed BEFORE UPDATE ON cost_expense_preset_sources BEGIN SELECT RAISE(ABORT,'Preset source immutable'); END;
 CREATE TRIGGER cost_preset_source_retained BEFORE DELETE ON cost_expense_preset_sources BEGIN SELECT RAISE(ABORT,'Preset source retained'); END;
`);}
