import { z } from "zod";
import type { Db } from "./db.js";
import { costVersion, expenseInput } from "./cost-validation.js";
import { normalizedExpense, validForPeriod } from "./cost-expense-input.js";
import {
  costExpenses,
  costTotals,
  type CostExpense,
  type CostCategory,
  type CostPeriodRow,
} from "./cost-model.js";
import { expectedCost } from "./cost-write.js";
import { boundedTotal, moneyUnits } from "./cost-money.js";
import { journalHash } from "./daily-journal-sources.js";
export const costTsvHeader =
  "categoryId\tspendDate\tdescription\tquantity\tunitPriceWon";
export const costBatchInput = costVersion.extend({
  tsv: z
    .string()
    .min(1)
    .max(102400)
    .refine(
      (s) => Buffer.byteLength(s, "utf8") <= 102400,
      "UTF-8 100KiB 한도입니다.",
    ),
});
export const costBatchCommit = costBatchInput.extend({
  previewDigest: z.string().regex(/^[a-f0-9]{64}$/),
  acknowledgeDuplicates: z.boolean(),
});
export type BatchExpense = ReturnType<typeof normalizedExpense>;
export type BatchRow = {
  line: number;
  expense: BatchExpense;
  priorPeriod: boolean;
  duplicateLines: number[];
  existingActive: number;
  existingCancelled: number;
};
export type CostBatchPreview = {
  version: number;
  rows: BatchRow[];
  errors: { line: number; message: string }[];
  hasDuplicates: boolean;
  batchAmount: string | null;
  projected: ReturnType<typeof costTotals> | null;
  digest: string | null;
};
function expenseKey(e: BatchExpense) {
  return JSON.stringify([
    e.categoryId,
    e.spendDate,
    e.description,
    e.quantity,
    e.unitPriceWon,
  ]);
}
export function previewCostBatch(
  db: Db,
  period: CostPeriodRow,
  input: z.infer<typeof costBatchInput>,
): CostBatchPreview {
  expectedCost(period, input.version);
  const raw = input.tsv.replace(/\r\n/g, "\n"),
    lines = raw.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const errors: CostBatchPreview["errors"] = [],
    rows: BatchRow[] = [];
  if (raw.includes("\r"))
    errors.push({
      line: 0,
      message:
        "단독 CR은 지원하지 않습니다. LF 또는 CRLF 행 구분을 사용하세요.",
    });
  if (lines[0] !== costTsvHeader)
    errors.push({
      line: 1,
      message:
        "고정 헤더가 일치하지 않습니다. BOM/공백/열 순서 변경은 지원하지 않습니다.",
    });
  if (lines.length < 2 || lines.length > 101)
    errors.push({
      line: 0,
      message: "헤더 외 지출1~100행이 필요합니다. 빈 행도 한 행입니다.",
    });
  if (errors.length)
    return {
      version: period.version,
      rows,
      errors,
      hasDuplicates: false,
      batchAmount: null,
      projected: null,
      digest: null,
    };
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split("\t");
    if (values.length !== 5) {
      errors.push({
        line: i + 1,
        message:
          "정확히5열이 필요합니다. 셀 내부 탭/개행·인용부호 escape는 지원하지 않습니다.",
      });
      continue;
    }
    try {
      const expense = normalizedExpense(
        expenseInput.parse({
          categoryId: values[0],
          spendDate: values[1],
          description: values[2],
          quantity: values[3],
          unitPriceWon: values[4],
        }),
      );
      validForPeriod(period, expense);
      rows.push({
        line: i + 1,
        expense,
        priorPeriod: expense.spendDate < period.month + "-01",
        duplicateLines: [],
        existingActive: 0,
        existingCancelled: 0,
      });
    } catch (error) {
      errors.push({
        line: i + 1,
        message:
          error instanceof z.ZodError
            ? error.issues
                .map((v) => v.path.join(".") + ": " + v.message)
                .join(";")
            : (error as Error).message,
      });
    }
  }
  const existing = costExpenses(db, period.id);
  for (const row of rows) {
    const key = expenseKey(row.expense);
    row.duplicateLines = rows
      .filter((r) => r.line !== row.line && expenseKey(r.expense) === key)
      .map((r) => r.line);
    for (const e of existing) {
      const saved = JSON.stringify([
        e.category_id,
        e.spend_date,
        e.description,
        e.quantity,
        e.unit_price_won,
      ]);
      if (saved === key) {
        if (e.status === "active") row.existingActive++;
        else row.existingCancelled++;
      }
    }
  }
  if (existing.length + rows.length > 1000)
    errors.push({
      line: 0,
      message: "보존 지출1,000행 한도를 넘습니다. 취소행도 포함합니다.",
    });
  let projected: CostBatchPreview["projected"] = null,
    batchAmount: string | null = null;
  if (!errors.length)
    try {
      batchAmount = boundedTotal(
        rows.reduce((sum, r) => sum + moneyUnits(r.expense.amount), 0n),
      );
      const candidates: CostExpense[] = rows.map((r) => ({
        id: "preview-" + r.line,
        period_id: period.id,
        category_id: r.expense.categoryId,
        spend_date: r.expense.spendDate,
        description: r.expense.description,
        quantity: r.expense.quantity,
        unit_price_won: r.expense.unitPriceWon,
        amount: r.expense.amount,
        status: "active",
        version: 1,
        created_by: "preview",
        created_at: "preview",
        updated_at: "preview",
      }));
      projected = costTotals(JSON.parse(period.categories) as CostCategory[], [
        ...existing,
        ...candidates,
      ]);
    } catch (error) {
      errors.push({ line: 0, message: (error as Error).message });
      batchAmount = null;
    }
  const hasDuplicates = rows.some(
    (r) =>
      r.duplicateLines.length > 0 ||
      r.existingActive > 0 ||
      r.existingCancelled > 0,
  );
  const result = {
    version: period.version,
    rows,
    errors,
    hasDuplicates,
    batchAmount,
    projected,
  };
  return {
    ...result,
    digest: errors.length
      ? null
      : journalHash({
          siteId: period.site_id,
          periodId: period.id,
          raw,
          ...result,
        }),
  };
}
