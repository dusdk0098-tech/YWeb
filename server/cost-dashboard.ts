import type { Express } from "express";
import type { Db } from "./db.js";
import type { SiteOperations } from "./site-operations.js";
import { costExpenses, costTotals, readCostSettings, type CostCategory } from "./cost-model.js";
import { moneyUnits } from "./cost-money.js";
// Ratio a/b as a percent string with one decimal, truncated (no rounding up).
export function percentText(a: bigint, b: bigint) {
  if (b <= 0n) return null;
  const tenths = (a * 1000n) / b;
  return `${tenths / 10n}.${(tenths < 0n ? -tenths : tenths) % 10n}`;
}
// SC 월마감 대시보드 numbers, computed from current ledgers (not closures).
export function costDashboard(db: Db, site: string) {
  const periods = db
    .prepare("SELECT id,month,status,categories FROM cost_periods WHERE site_id=? ORDER BY month")
    .all(site) as { id: string; month: string; status: string; categories: string }[];
  const months = periods.map((p) => {
    const totals = costTotals(JSON.parse(p.categories) as CostCategory[], costExpenses(db, p.id));
    return { id: p.id, month: p.month, status: p.status, current: totals.total.current, count: totals.activeCount, totals };
  });
  const latest = months.at(-1);
  if (!latest) return { months: [], latest: null };
  const settings = readCostSettings(db, latest.id),
    budget = settings?.safetyBudgetWon ? moneyUnits(settings.safetyBudgetWon) : null,
    used = months.map((m) => moneyUnits(m.current)).filter((v) => v > 0n),
    cumulative = moneyUnits(latest.totals.total.cumulative);
  let monthsLeft: string | null = null;
  if (budget !== null && used.length) {
    const left = budget - cumulative,
      tenths = left <= 0n ? 0n : (left * 10n * BigInt(used.length)) / used.reduce((a, b) => a + b, 0n);
    monthsLeft = `${tenths / 10n}.${tenths % 10n}`;
  }
  return {
    months: months.map(({ totals: _totals, ...m }) => m),
    latest: {
      id: latest.id,
      month: latest.month,
      status: latest.status,
      safetyBudgetWon: settings?.safetyBudgetWon || null,
      total: latest.totals.total,
      usedPercent: budget === null ? null : percentText(cumulative, budget),
      monthsLeft,
      byCategory: latest.totals.byCategory.map((c) => ({
        id: c.id,
        label: c.label,
        plan: c.plan,
        opening: c.opening,
        current: c.current,
        cumulative: c.cumulative,
        remaining: c.remaining,
        usedPercent: budget === null ? null : percentText(moneyUnits(c.cumulative), budget),
      })),
    },
  };
}
export function registerCostDashboard(app: Express, db: Db, { access }: SiteOperations) {
  app.get("/api/sites/:siteId/cost-dashboard", (req, res) => {
    access(req, true, true);
    res.json(costDashboard(db, String(req.params.siteId)));
  });
}
