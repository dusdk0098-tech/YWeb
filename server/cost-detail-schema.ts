import type { Db } from "./db.js";
// IF NOT EXISTS: older-schema test fixtures drop only the tables they know about.
// SC 항목별 추가필드 per expense; beside cost_expenses so expense rows and closure bytes are unchanged.
export function migrateCostDetails(db: Db) {
  db.exec(`
 CREATE TABLE IF NOT EXISTS cost_expense_details(expense_id TEXT PRIMARY KEY REFERENCES cost_expenses(id),body TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS cost_details_open_insert BEFORE INSERT ON cost_expense_details WHEN NOT EXISTS(SELECT 1 FROM cost_expenses e JOIN cost_periods p ON p.id=e.period_id WHERE e.id=NEW.expense_id AND p.status='open')
 BEGIN SELECT RAISE(ABORT,'Expense details require open period'); END;
 CREATE TRIGGER IF NOT EXISTS cost_details_open_update BEFORE UPDATE ON cost_expense_details WHEN NEW.expense_id IS NOT OLD.expense_id OR NOT EXISTS(SELECT 1 FROM cost_expenses e JOIN cost_periods p ON p.id=e.period_id WHERE e.id=OLD.expense_id AND p.status='open')
 BEGIN SELECT RAISE(ABORT,'Expense details require open period'); END;
 CREATE TRIGGER IF NOT EXISTS cost_details_open_delete BEFORE DELETE ON cost_expense_details WHEN NOT EXISTS(SELECT 1 FROM cost_expenses e JOIN cost_periods p ON p.id=e.period_id WHERE e.id=OLD.expense_id AND p.status='open')
 BEGIN SELECT RAISE(ABORT,'Expense details require open period'); END;
 PRAGMA user_version=59;
`);
}
