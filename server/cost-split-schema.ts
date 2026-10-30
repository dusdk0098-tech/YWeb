import type { Db } from "./db.js";
export function migrateCostSplits(db: Db) {
  db.exec(`
 CREATE TABLE cost_splits(id TEXT PRIMARY KEY,period_id TEXT NOT NULL REFERENCES cost_periods(id),source_expense_id TEXT NOT NULL REFERENCES cost_expenses(id),
 body TEXT NOT NULL,hash TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('active','undone')),undo_snapshot TEXT,undo_hash TEXT,created_at TEXT NOT NULL);
 CREATE UNIQUE INDEX cost_split_active_source ON cost_splits(source_expense_id) WHERE status='active';
 CREATE INDEX cost_split_period ON cost_splits(period_id,created_at,id);
 CREATE TABLE cost_split_children(expense_id TEXT PRIMARY KEY REFERENCES cost_expenses(id),split_id TEXT NOT NULL REFERENCES cost_splits(id));
 CREATE TRIGGER cost_split_frozen BEFORE UPDATE ON cost_splits WHEN OLD.status!='active' OR NEW.status!='undone' OR NEW.undo_snapshot IS NULL OR NEW.undo_hash IS NULL
 OR NEW.id IS NOT OLD.id OR NEW.period_id IS NOT OLD.period_id OR NEW.source_expense_id IS NOT OLD.source_expense_id OR NEW.body IS NOT OLD.body OR NEW.hash IS NOT OLD.hash OR NEW.created_at IS NOT OLD.created_at
 BEGIN SELECT RAISE(ABORT,'Split snapshot immutable; only explicit undo allowed'); END;
 CREATE TRIGGER cost_split_no_delete BEFORE DELETE ON cost_splits BEGIN SELECT RAISE(ABORT,'Split history immutable'); END;
 CREATE TRIGGER cost_split_child_no_update BEFORE UPDATE ON cost_split_children BEGIN SELECT RAISE(ABORT,'Split child provenance immutable'); END;
 CREATE TRIGGER cost_split_child_no_delete BEFORE DELETE ON cost_split_children BEGIN SELECT RAISE(ABORT,'Split child provenance immutable'); END;
 CREATE TRIGGER cost_split_source_check BEFORE INSERT ON cost_splits WHEN NOT EXISTS(SELECT 1 FROM cost_expenses WHERE id=NEW.source_expense_id AND period_id=NEW.period_id AND status='cancelled')
 OR EXISTS(SELECT 1 FROM cost_split_children WHERE expense_id=NEW.source_expense_id)
 BEGIN SELECT RAISE(ABORT,'Split source must be cancelled original in same ledger'); END;
 CREATE TRIGGER cost_split_child_check BEFORE INSERT ON cost_split_children WHEN NOT EXISTS(SELECT 1 FROM cost_expenses e JOIN cost_splits s ON s.period_id=e.period_id WHERE e.id=NEW.expense_id AND s.id=NEW.split_id AND e.id!=s.source_expense_id)
 BEGIN SELECT RAISE(ABORT,'Split child ledger mismatch'); END;
 CREATE TRIGGER cost_split_active_source_frozen BEFORE UPDATE ON cost_expenses WHEN EXISTS(SELECT 1 FROM cost_splits WHERE source_expense_id=OLD.id AND status='active')
 BEGIN SELECT RAISE(ABORT,'Undo split explicitly before changing source'); END;
 CREATE TRIGGER cost_split_undone_child_restore BEFORE UPDATE ON cost_expenses WHEN NEW.status='active' AND OLD.status='cancelled' AND EXISTS(
 SELECT 1 FROM cost_split_children c JOIN cost_splits s ON s.id=c.split_id WHERE c.expense_id=OLD.id AND s.status='undone')
 BEGIN SELECT RAISE(ABORT,'Undone split child cannot restore'); END;
 PRAGMA user_version=19;
`);
}
