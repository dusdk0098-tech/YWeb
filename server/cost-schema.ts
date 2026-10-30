import type { Db } from "./db.js";
export function migrateCosts(db: Db) {
  db.exec(`
 CREATE TABLE cost_periods (
 id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),month TEXT NOT NULL,categories TEXT NOT NULL,opening_note TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('open','closed')),version INTEGER NOT NULL,
 parent_period_id TEXT UNIQUE REFERENCES cost_periods(id),source_close_id TEXT REFERENCES cost_closures(id),current_close_id TEXT REFERENCES cost_closures(id),
 created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(site_id,month));
 CREATE INDEX cost_periods_site ON cost_periods(site_id,month,id);
 CREATE TABLE cost_expenses (
 id TEXT PRIMARY KEY,period_id TEXT NOT NULL REFERENCES cost_periods(id),category_id TEXT NOT NULL,spend_date TEXT NOT NULL,description TEXT NOT NULL,
 quantity TEXT NOT NULL,unit_price_won TEXT NOT NULL,amount TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('active','cancelled')),version INTEGER NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE INDEX cost_expenses_period ON cost_expenses(period_id,created_at,id);
 CREATE TABLE cost_closures(id TEXT PRIMARY KEY,period_id TEXT NOT NULL REFERENCES cost_periods(id),number INTEGER NOT NULL,body TEXT NOT NULL,hash TEXT NOT NULL,closed_at TEXT NOT NULL,UNIQUE(period_id,number));
 CREATE TABLE cost_events(id INTEGER PRIMARY KEY,period_id TEXT NOT NULL REFERENCES cost_periods(id),version INTEGER NOT NULL,event TEXT NOT NULL,
 expense_id TEXT REFERENCES cost_expenses(id),actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,at TEXT NOT NULL,reason TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(period_id,version));
 CREATE TRIGGER cost_period_origin BEFORE UPDATE ON cost_periods WHEN NEW.id IS NOT OLD.id OR NEW.site_id IS NOT OLD.site_id OR NEW.month IS NOT OLD.month
 OR NEW.parent_period_id IS NOT OLD.parent_period_id OR NEW.source_close_id IS NOT OLD.source_close_id OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
 BEGIN SELECT RAISE(ABORT,'Cost period origin immutable'); END;
 CREATE TRIGGER cost_closed_guard BEFORE UPDATE ON cost_periods WHEN OLD.status='closed' AND NOT(
 NEW.status='open' AND NEW.categories IS OLD.categories AND NEW.opening_note IS OLD.opening_note AND NEW.current_close_id IS NULL AND NEW.version=OLD.version+1
 AND NOT EXISTS(SELECT 1 FROM cost_periods WHERE parent_period_id=OLD.id))
 BEGIN SELECT RAISE(ABORT,'Closed or carried cost period cannot be edited'); END;
 CREATE TRIGGER cost_period_no_delete BEFORE DELETE ON cost_periods BEGIN SELECT RAISE(ABORT,'Cost period cannot be deleted'); END;
 CREATE TRIGGER cost_carry_origin BEFORE INSERT ON cost_periods WHEN NEW.parent_period_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM cost_periods p JOIN cost_closures c ON c.period_id=p.id WHERE p.id=NEW.parent_period_id AND p.site_id=NEW.site_id AND p.status='closed' AND c.id=NEW.source_close_id AND p.current_close_id=c.id)
 BEGIN SELECT RAISE(ABORT,'Carry requires current closed source in site'); END;
 CREATE TRIGGER cost_expense_insert BEFORE INSERT ON cost_expenses WHEN NOT EXISTS(
 SELECT 1 FROM cost_periods p,json_each(p.categories) c WHERE p.id=NEW.period_id AND p.status='open' AND json_extract(c.value,'$.id')=NEW.category_id)
 BEGIN SELECT RAISE(ABORT,'Expense requires open period/category'); END;
 CREATE TRIGGER cost_expense_update BEFORE UPDATE ON cost_expenses WHEN NEW.id IS NOT OLD.id OR NEW.period_id IS NOT OLD.period_id OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at OR NOT EXISTS(
 SELECT 1 FROM cost_periods p,json_each(p.categories) c WHERE p.id=OLD.period_id AND p.status='open' AND json_extract(c.value,'$.id')=NEW.category_id)
 BEGIN SELECT RAISE(ABORT,'Expense origin/open period/category required'); END;
 CREATE TRIGGER cost_expense_no_delete BEFORE DELETE ON cost_expenses BEGIN SELECT RAISE(ABORT,'Expense cannot be deleted'); END;
 CREATE TRIGGER cost_closure_no_update BEFORE UPDATE ON cost_closures BEGIN SELECT RAISE(ABORT,'Cost closure immutable'); END;
 CREATE TRIGGER cost_closure_no_delete BEFORE DELETE ON cost_closures BEGIN SELECT RAISE(ABORT,'Cost closure immutable'); END;
 CREATE TRIGGER cost_event_no_update BEFORE UPDATE ON cost_events BEGIN SELECT RAISE(ABORT,'Cost event immutable'); END;
 CREATE TRIGGER cost_event_no_delete BEFORE DELETE ON cost_events BEGIN SELECT RAISE(ABORT,'Cost event immutable'); END;
 PRAGMA user_version=13;
`);
}
