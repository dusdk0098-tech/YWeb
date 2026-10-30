import type { Db } from "./db.js";
// IF NOT EXISTS: older-schema test fixtures drop only the tables they know about.
// SC 인건비 구분 per expense; kept beside cost_expenses so expense rows and closure bytes are unchanged.
export function migrateCostLabor(db: Db) {
  db.exec(`
 CREATE TABLE IF NOT EXISTS cost_expense_labor(expense_id TEXT PRIMARY KEY REFERENCES cost_expenses(id),kind TEXT NOT NULL CHECK(kind IN('전담 안전관리자','겸직 안전관리자','안전관리자','장비유도수','타워신호수','지상감시자','화기감시자','관리감독자(안전담당자)','기타')),updated_at TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS cost_labor_open_insert BEFORE INSERT ON cost_expense_labor WHEN NOT EXISTS(SELECT 1 FROM cost_expenses e JOIN cost_periods p ON p.id=e.period_id WHERE e.id=NEW.expense_id AND p.status='open')
 BEGIN SELECT RAISE(ABORT,'Labor kind requires open period'); END;
 CREATE TRIGGER IF NOT EXISTS cost_labor_open_update BEFORE UPDATE ON cost_expense_labor WHEN NEW.expense_id IS NOT OLD.expense_id OR NOT EXISTS(SELECT 1 FROM cost_expenses e JOIN cost_periods p ON p.id=e.period_id WHERE e.id=OLD.expense_id AND p.status='open')
 BEGIN SELECT RAISE(ABORT,'Labor kind requires open period'); END;
 CREATE TRIGGER IF NOT EXISTS cost_labor_open_delete BEFORE DELETE ON cost_expense_labor WHEN NOT EXISTS(SELECT 1 FROM cost_expenses e JOIN cost_periods p ON p.id=e.period_id WHERE e.id=OLD.expense_id AND p.status='open')
 BEGIN SELECT RAISE(ABORT,'Labor kind requires open period'); END;
 PRAGMA user_version=58;
`);
}
