import type { Request } from "express";
import { audit, type Db } from "./db.js";
import { account } from "./inspection-model.js";
import { HttpError } from "./site-operations.js";
import {
  getCostPeriod,
  costPeriodView,
  type CostPeriodRow,
  type CostExpense,
} from "./cost-model.js";
export function expectedCost(
  row: CostPeriodRow,
  version: number,
  state: "open" | "closed" = "open",
) {
  if (row.version !== version || row.status !== state)
    throw new HttpError(
      409,
      "원장 상태/버전이 변경되었습니다. 입력을 보관하고 최신본을 다시 여세요.",
    );
}
export function bumpCost(db: Db, row: CostPeriodRow) {
  db.prepare(
    "UPDATE cost_periods SET version=version+1,updated_at=? WHERE id=?",
  ).run(new Date().toISOString(), row.id);
  return getCostPeriod(db, row.site_id, row.id);
}
export function costEvent(
  db: Db,
  req: Request,
  row: CostPeriodRow,
  event: string,
  reason: string,
  expense: CostExpense | null = null,
) {
  const actor = account(db, req.session.userId!),
    view = costPeriodView(db, row);
  db.prepare(
    "INSERT INTO cost_events(period_id,version,event,expense_id,actor_id,actor_name,at,reason,data) VALUES(?,?,?,?,?,?,?,?,?)",
  ).run(
    row.id,
    row.version,
    event,
    expense?.id || null,
    actor.id,
    actor.name,
    row.updated_at,
    reason,
    JSON.stringify({
      categories: view.categories,
      totals: view.totals,
      expense,
      currentCloseId: row.current_close_id,
      status: row.status,
    }),
  );
  audit(db, actor.id, row.site_id, "cost." + event, row.id);
  return view;
}
