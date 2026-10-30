import { z } from "zod";
import type { Db } from "./db.js";
import { date } from "./validation.js";
import { journalMonth } from "./daily-monthly-report.js";
import { HttpError } from "./site-operations.js";
import { lineAmount } from "./cost-money.js";
export const costSearchQuery = z
  .object({
    monthFrom: journalMonth.optional(),
    monthTo: journalMonth.optional(),
    dateFrom: date.optional(),
    dateTo: date.optional(),
    status: z.enum(["all", "active", "cancelled"]).default("all"),
    text: z
      .string()
      .max(100)
      .refine(
        (s) =>
          Array.from(s).every(
            (c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127,
          ),
        "검색 문자열에 제어문자를 사용할 수 없습니다.",
      )
      .default(""),
    offset: z.coerce.number().int().min(0).max(1000000).default(0),
  })
  .strict()
  .refine(
    (q) => !q.monthFrom || !q.monthTo || q.monthFrom <= q.monthTo,
    "귀속 월 시작이 끝보다 늦습니다.",
  )
  .refine(
    (q) => !q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo,
    "지출일 시작이 끝보다 늦습니다.",
  );
export type CostSearchQuery = z.infer<typeof costSearchQuery>;
export type CostSearchItem = {
  id: string;
  periodId: string;
  periodMonth: string;
  periodStatus: "open" | "closed";
  periodVersion: number;
  categoryId: string;
  categoryLabel: string;
  spendDate: string;
  description: string;
  quantity: string;
  unitPriceWon: string;
  amount: string;
  status: "active" | "cancelled";
  version: number;
  childOfSplitId: string | null;
  childSplitStatus: "active" | "undone" | null;
  activeSourceSplitId: string | null;
  hasSourceSplitHistory: number;
};
export type CostSearchResult = {
  siteId: string;
  query: CostSearchQuery;
  items: CostSearchItem[];
  hasMore: boolean;
  limit: number;
  generatedAt: string;
};
export function escapeCostSearchText(text: string) {
  return text.replace(/[\\%_]/g, (c) => "\\" + c);
}
export function readCostSearch(
  db: Db,
  site: string,
  user: string,
  q: CostSearchQuery,
): CostSearchResult {
  db.exec("BEGIN DEFERRED");
  try {
    if (
      !db
        .prepare(
          "SELECT 1 FROM memberships WHERE site_id=? AND user_id=? AND role='manager'",
        )
        .get(site, user)
    )
      throw new HttpError(
        403,
        "이 현장의 현재 관리자만 비용 검색을 조회할 수 있습니다.",
      );
    const where = ["p.site_id=?"],
      values: (string | number)[] = [site];
    for (const [value, clause] of [
      [q.monthFrom, "p.month>=?"],
      [q.monthTo, "p.month<=?"],
      [q.dateFrom, "e.spend_date>=?"],
      [q.dateTo, "e.spend_date<=?"],
    ] as const)
      if (value) {
        where.push(clause);
        values.push(value);
      }
    if (q.status !== "all") {
      where.push("e.status=?");
      values.push(q.status);
    }
    if (q.text) {
      where.push("e.description LIKE ? ESCAPE '\\'");
      values.push("%" + escapeCostSearchText(q.text) + "%");
    }
    const rows = db
      .prepare(
        `SELECT e.id,e.period_id AS periodId,p.month AS periodMonth,p.status AS periodStatus,p.version AS periodVersion,
 e.category_id AS categoryId,(SELECT json_extract(value,'$.label') FROM json_each(p.categories) WHERE json_extract(value,'$.id')=e.category_id LIMIT 1) AS categoryLabel,
 e.spend_date AS spendDate,e.description,e.quantity,e.unit_price_won AS unitPriceWon,e.amount,e.status,e.version,
 c.split_id AS childOfSplitId,cs.status AS childSplitStatus,
 (SELECT id FROM cost_splits WHERE source_expense_id=e.id AND period_id=p.id AND status='active') AS activeSourceSplitId,
 EXISTS(SELECT 1 FROM cost_splits WHERE source_expense_id=e.id AND period_id=p.id) AS hasSourceSplitHistory
 FROM cost_expenses e JOIN cost_periods p ON p.id=e.period_id LEFT JOIN cost_split_children c ON c.expense_id=e.id LEFT JOIN cost_splits cs ON cs.id=c.split_id
 WHERE ${where.join(" AND ")} ORDER BY e.spend_date DESC,p.month DESC,e.id ASC LIMIT 51 OFFSET ?`,
      )
      .all(...values, q.offset) as CostSearchItem[];
    for (const row of rows) {
      if (
        !row.categoryLabel ||
        lineAmount(row.quantity, row.unitPriceWon) !== row.amount
      )
        throw new HttpError(
          409,
          "검색 원장의 항목/금액 자료가 일치하지 않습니다. 원장을 확인하세요.",
        );
    }
    const result = {
      siteId: site,
      query: q,
      items: rows.slice(0, 50),
      hasMore: rows.length > 50,
      limit: 50,
      generatedAt: new Date().toISOString(),
    };
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
