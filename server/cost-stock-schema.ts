import type { Db } from "./db.js";
// Next schema number assigned only after preceding phase is frozen.
export function createCostStockTables(db:Db){
 db.exec(`CREATE TABLE cost_stock_receipts(
 id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),period_id TEXT NOT NULL REFERENCES cost_periods(id),expense_id TEXT NOT NULL REFERENCES cost_expenses(id),item_id TEXT NOT NULL REFERENCES stock_items(id),
 movement_id TEXT NOT NULL UNIQUE REFERENCES stock_movements(id),snapshot TEXT NOT NULL,snapshot_hash TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('active','reversed')),
 reversal_movement_id TEXT UNIQUE REFERENCES stock_movements(id),reversal_snapshot TEXT,reversal_hash TEXT,created_at TEXT NOT NULL);
 CREATE UNIQUE INDEX cost_stock_one_active ON cost_stock_receipts(expense_id) WHERE status='active';
 CREATE INDEX cost_stock_expense ON cost_stock_receipts(expense_id,created_at,id);
 CREATE TRIGGER cost_stock_receipt_retained BEFORE DELETE ON cost_stock_receipts BEGIN SELECT RAISE(ABORT,'Cost receipt retained'); END;
 CREATE TRIGGER cost_stock_receipt_fixed BEFORE UPDATE ON cost_stock_receipts WHEN
 OLD.status!='active' OR NEW.status!='reversed' OR NEW.reversal_movement_id IS NULL OR NEW.reversal_snapshot IS NULL OR NEW.reversal_hash IS NULL OR
 NEW.id IS NOT OLD.id OR NEW.site_id IS NOT OLD.site_id OR NEW.period_id IS NOT OLD.period_id OR NEW.expense_id IS NOT OLD.expense_id OR NEW.item_id IS NOT OLD.item_id OR NEW.movement_id IS NOT OLD.movement_id OR NEW.snapshot IS NOT OLD.snapshot OR NEW.snapshot_hash IS NOT OLD.snapshot_hash OR NEW.created_at IS NOT OLD.created_at OR
 NOT EXISTS(SELECT 1 FROM stock_movements m WHERE m.id=NEW.reversal_movement_id AND m.item_id=OLD.item_id AND m.kind='reversal' AND m.reverses_id=OLD.movement_id)
 BEGIN SELECT RAISE(ABORT,'Only explicit full receipt reversal allowed'); END;
 CREATE TRIGGER cost_stock_split_guard BEFORE INSERT ON cost_splits WHEN EXISTS(SELECT 1 FROM cost_stock_receipts WHERE expense_id=NEW.source_expense_id AND status='active')
 BEGIN SELECT RAISE(ABORT,'Reverse linked stock receipt before splitting'); END;
 CREATE TRIGGER cost_stock_split_undo_guard BEFORE UPDATE ON cost_splits WHEN NEW.status='undone' AND EXISTS(SELECT 1 FROM cost_split_children c JOIN cost_stock_receipts r ON r.expense_id=c.expense_id AND r.status='active' WHERE c.split_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'Reverse child stock receipts before split undo'); END;`);
}

export function migrateCostStock(db:Db){createCostStockTables(db);db.exec("PRAGMA user_version=35");}
