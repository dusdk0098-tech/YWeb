import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { getCostPeriod, getExpense, type CostPeriodRow } from "./cost-model.js";
import { bumpCost, costEvent } from "./cost-write.js";
import {
  costBatchInput,
  costBatchCommit,
  previewCostBatch,
} from "./cost-batch.js";
export function registerCostBatch(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  const base = "/api/sites/:siteId/cost-periods/:id/expense-batch";
  app.post(base + "/preview", (req, res) => {
    access(req, true, true);
    const input = costBatchInput.parse(req.body);
    db.exec("BEGIN DEFERRED");
    try {
      const row = getCostPeriod(
        db,
        String(req.params.siteId),
        String(req.params.id),
      );
      const result = previewCostBatch(db, row, input);
      db.exec("COMMIT");
      res.json(result);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
  app.post(base + "/commit", (req, res) => {
    access(req, true, true);
    const input = costBatchCommit.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    getCostPeriod(db, site, id);
    mutate(
      req,
      res,
      `cost:batch:${site}:${id}`,
      input,
      () => {
        let row: CostPeriodRow = getCostPeriod(db, site, id);
        const preview = previewCostBatch(db, row, input);
        if (preview.errors.length || !preview.digest)
          throw new HttpError(
            400,
            "검토 오류가 있습니다. TSV를 수정하고 다시 검토하세요.",
          );
        if (preview.digest !== input.previewDigest)
          throw new HttpError(
            409,
            "검토 내용/원장이 달라졌습니다. 다시 검토하세요.",
          );
        if (preview.hasDuplicates && !input.acknowledgeDuplicates)
          throw new HttpError(
            400,
            "중복 경고를 확인하고 실제 별도 지출인지 명시적으로 확인하세요.",
          );
        const ids: string[] = [];
        let period;
        for (const r of preview.rows) {
          const e = r.expense,
            expenseId = randomUUID(),
            now = new Date().toISOString();
          db.prepare(
            "INSERT INTO cost_expenses VALUES(?,?,?,?,?,?,?,?,'active',1,?,?,?)",
          ).run(
            expenseId,
            id,
            e.categoryId,
            e.spendDate,
            e.description,
            e.quantity,
            e.unitPriceWon,
            e.amount,
            req.session.userId!,
            now,
            now,
          );
          row = bumpCost(db, row);
          period = costEvent(
            db,
            req,
            row,
            "expense_batch_created",
            `TSV 행 ${r.line} · 검토 ${preview.digest}`,
            getExpense(db, id, expenseId),
          );
          ids.push(expenseId);
        }
        audit(db, req.session.userId!, site, "cost.batch_committed", id);
        return {
          period,
          createdIds: ids,
          count: ids.length,
          batchAmount: preview.batchAmount,
          previewDigest: preview.digest,
        };
      },
      () => {
        access(req, true, true);
      },
    );
  });
}
