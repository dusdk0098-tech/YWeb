import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import {
  moneyUnits,
  lineAmount,
  boundedTotal,
  decimalText,
} from "./cost-money.js";
export type CostCategory = {
  id: string;
  label: string;
  plan: string;
  opening: string;
};
export type CostPeriodRow = {
  id: string;
  site_id: string;
  month: string;
  categories: string;
  opening_note: string;
  status: "open" | "closed";
  version: number;
  parent_period_id: string | null;
  source_close_id: string | null;
  current_close_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};
export type CostExpense = {
  id: string;
  period_id: string;
  category_id: string;
  spend_date: string;
  description: string;
  quantity: string;
  unit_price_won: string;
  amount: string;
  status: "active" | "cancelled";
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};
export function getCostPeriod(db: Db, site: string, id: string) {
  const row = db
    .prepare("SELECT * FROM cost_periods WHERE site_id=? AND id=?")
    .get(site, id) as CostPeriodRow | undefined;
  if (!row) throw new HttpError(404, "비용 원장을 찾을 수 없습니다.");
  return row;
}
export function costExpenses(db: Db, id: string) {
  const rows = db
    .prepare(
      "SELECT * FROM cost_expenses WHERE period_id=? ORDER BY created_at,id LIMIT 1001",
    )
    .all(id) as CostExpense[];
  if (rows.length > 1000)
    throw new HttpError(
      400,
      "원장 보존 행이1,000건을 넘어 처리할 수 없습니다.",
    );
  return rows;
}
export function getExpense(db: Db, period: string, id: string) {
  const row = db
    .prepare("SELECT * FROM cost_expenses WHERE period_id=? AND id=?")
    .get(period, id) as CostExpense | undefined;
  if (!row) throw new HttpError(404, "지출 기록을 찾을 수 없습니다.");
  return row;
}
export function costTotals(categories: CostCategory[], rows: CostExpense[]) {
  const amounts = new Map(categories.map((c) => [c.id, 0n]));
  let activeCount = 0,
    cancelledCount = 0;
  for (const row of rows) {
    if (
      !amounts.has(row.category_id) ||
      lineAmount(row.quantity, row.unit_price_won) !== row.amount
    )
      throw new HttpError(
        409,
        "저장된 지출의 항목/계산 결과가 일치하지 않습니다.",
      );
    if (row.status === "active") {
      amounts.set(
        row.category_id,
        amounts.get(row.category_id)! + moneyUnits(row.amount),
      );
      activeCount++;
    } else cancelledCount++;
  }
  let planTotal = 0n,
    openingTotal = 0n,
    currentTotal = 0n;
  const byCategory = categories.map((c) => {
    const plan = moneyUnits(c.plan),
      opening = moneyUnits(c.opening),
      current = amounts.get(c.id)!;
    planTotal += plan;
    openingTotal += opening;
    currentTotal += current;
    return {
      ...c,
      current: boundedTotal(current),
      cumulative: boundedTotal(opening + current),
      remaining: decimalText(plan - opening - current),
      overPlan: opening + current > plan,
    };
  });
  return {
    byCategory,
    total: {
      plan: boundedTotal(planTotal),
      opening: boundedTotal(openingTotal),
      current: boundedTotal(currentTotal),
      cumulative: boundedTotal(openingTotal + currentTotal),
      remaining: decimalText(planTotal - openingTotal - currentTotal),
    },
    activeCount,
    cancelledCount,
  };
}
export function costPeriodView(db: Db, row: CostPeriodRow) {
  const categories = JSON.parse(row.categories) as CostCategory[],
    totals = costTotals(categories, costExpenses(db, row.id)),
    child = db
      .prepare(
        "SELECT id,month FROM cost_periods WHERE parent_period_id=? AND site_id=?",
      )
      .get(row.id, row.site_id) as { id: string; month: string } | undefined;
  const closure = row.current_close_id
    ? (db
        .prepare(
          "SELECT id,number,hash,closed_at FROM cost_closures WHERE id=? AND period_id=?",
        )
        .get(row.current_close_id, row.id) as {
        id: string;
        number: number;
        hash: string;
        closed_at: string;
      })
    : null;
  return {
    ...row,
    categories,
    totals,
    currentClosure: closure,
    successor: child || null,
  };
}
export type CostPeriod = ReturnType<typeof costPeriodView>;
export type CostSnapshot = {
  schema: 1;
  id: string;
  number: number;
  site: { id: string; name: string };
  period: Omit<CostPeriodRow, "categories"> & { categories: CostCategory[] };
  totals: ReturnType<typeof costTotals>;
  expenses: CostExpense[];
  closedBy: { id: string; name: string };
  closedAt: string;
  reason: string;
  policy: "exact-six-decimal-whole-won-price-v1";
};
export function nextCostMonth(month: string) {
  const [year, m] = month.split("-").map(Number);
  if (year === 9999 && m === 12)
    throw new HttpError(
      400,
      "다음 원장 월이 허용된4자리 연도 범위를 넘습니다.",
    );
  return (
    String(m === 12 ? year + 1 : year).padStart(4, "0") +
    "-" +
    String(m === 12 ? 1 : m + 1).padStart(2, "0")
  );
}
export function lastCostDate(month: string) {
  const d = new Date(month + "-01T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return month + "-" + String(d.getUTCDate()).padStart(2, "0");
}
