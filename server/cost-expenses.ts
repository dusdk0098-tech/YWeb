import { presetReference, exactActivePreset, saveExpensePresetSource } from "./cost-preset-model.js";
import { stockUnchangedAcknowledgment, assertCostStockAcknowledgment } from "./cost-stock-model.js";
import { normalizedExpense, validForPeriod } from "./cost-expense-input.js";
import { assertSplitRestore } from "./cost-split-model.js";
import type { Express } from "express";
import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { inspectionPage } from "./inspection-validation.js";
import { expenseCreate, expenseEdit, costReason, laborKinds } from "./cost-validation.js";
import { journalMonth } from "./daily-monthly-report.js";
import { moneyUnits, decimalText } from "./cost-money.js";
import { getCostPeriod, getExpense, costExpenses, insertExpense, saveLaborKind } from "./cost-model.js";
import { expectedCost, bumpCost, costEvent } from "./cost-write.js";
export function registerCostExpenses(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  const base = "/api/sites/:siteId/cost-periods/:id/expenses";
  // SC 인건비 조회: active expenses with an explicit 인건비 구분, across all months of the site.
  app.get("/api/sites/:siteId/cost-labor", (req, res) => {
    access(req, true, true);
    const q = inspectionPage
        .extend({ month: z.union([z.literal(""), journalMonth]).default(""), q: z.string().trim().max(100).default("") })
        .parse(req.query),
      rows = db
        .prepare(
          `SELECT p.month,l.kind,e.id,e.spend_date,e.description,e.quantity,e.amount FROM cost_expense_labor l
           JOIN cost_expenses e ON e.id=l.expense_id JOIN cost_periods p ON p.id=e.period_id
           WHERE p.site_id=? AND e.status='active' AND (?='' OR p.month=?) AND (?='' OR instr(e.description,?)>0 OR instr(l.kind,?)>0)
           ORDER BY p.month DESC,e.spend_date,e.id`,
        )
        .all(String(req.params.siteId), q.month, q.month, q.q, q.q, q.q) as { kind: string; amount: string }[],
      sums = new Map<string, bigint>(laborKinds.map((k) => [k, 0n]));
    for (const r of rows) sums.set(r.kind, sums.get(r.kind)! + moneyUnits(r.amount));
    res.json({
      items: rows.slice(q.offset, q.offset + 50),
      hasMore: rows.length > q.offset + 50,
      byKind: [...sums].map(([kind, units]) => ({ kind, amount: decimalText(units) })),
      total: decimalText([...sums.values()].reduce((a, b) => a + b, 0n)),
    });
  });
  app.get(base, (req, res) => {
    access(req, true, true);
    const row = getCostPeriod(
        db,
        String(req.params.siteId),
        String(req.params.id),
      ),
      q = inspectionPage.extend({ categoryId: z.string().max(100).optional() }).parse(req.query),
      // categoryId: SC 항목별 상세 — that category's active rows only.
      all = costExpenses(db, row.id).filter(
        (e) => !q.categoryId || (e.category_id === q.categoryId && e.status === "active"),
      );
    res.json({
      items: all.slice(q.offset, q.offset + 50),
      hasMore: all.length > q.offset + 50,
    });
  });
  app.get(base + "/:expenseId", (req, res) => {
    access(req, true, true);
    const row = getCostPeriod(
      db,
      String(req.params.siteId),
      String(req.params.id),
    );
    res.json(getExpense(db, row.id, String(req.params.expenseId)));
  });
  app.post(base, (req, res) => {
    access(req, true, true);
    const input = expenseCreate.extend({presetSource:presetReference.optional()}).parse(req.body),
      expense = normalizedExpense(input.expense),
      v = { version: input.version, expense, ...(input.presetSource ? {presetSource:input.presetSource} : {}), ...(input.laborKind !== undefined ? { laborKind: input.laborKind } : {}) },
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `cost:expense:create:${site}:${id}`,
      v,
      () => {
        const row = getCostPeriod(db, site, id);
        expectedCost(row, v.version);
        validForPeriod(row, expense);
        const selectedPreset = v.presetSource ? exactActivePreset(db,site,v.presetSource) : null;
        const now = new Date().toISOString(),
          nextId = insertExpense(db, id, expense, req.session.userId!, now);
        saveLaborKind(db, nextId, v.laborKind, now);
        if(selectedPreset)saveExpensePresetSource(db,site,getExpense(db,id,nextId),selectedPreset,now);
        const saved = getExpense(db, id, nextId),
          period = costEvent(
            db,
            req,
            bumpCost(db, row),
            "expense_created",
            "양수 지출 기록 생성",
            saved,
          );
        return { period, expense: saved };
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.put(base + "/:expenseId", (req, res) => {
    access(req, true, true);
    const input = expenseEdit.extend({stockAcknowledgment:stockUnchangedAcknowledgment.optional()}).parse(req.body),
      v = { ...input, expense: normalizedExpense(input.expense) },
      site = String(req.params.siteId),
      id = String(req.params.id),
      expenseId = String(req.params.expenseId);
    mutate(
      req,
      res,
      `cost:expense:edit:${site}:${id}:${expenseId}`,
      v,
      () => {
        const row = getCostPeriod(db, site, id);
        expectedCost(row, v.version);
        const old = getExpense(db, id, expenseId);
        if (old.status !== "active")
          throw new HttpError(409, "취소 지출은 복원 후 수정하세요.");
        assertCostStockAcknowledgment(db,expenseId,v.stockAcknowledgment);
        validForPeriod(row, v.expense);
        db.prepare(
          "UPDATE cost_expenses SET category_id=?,spend_date=?,description=?,quantity=?,unit_price_won=?,amount=?,version=version+1,updated_at=? WHERE id=?",
        ).run(
          v.expense.categoryId,
          v.expense.spendDate,
          v.expense.description,
          v.expense.quantity,
          v.expense.unitPriceWon,
          v.expense.amount,
          new Date().toISOString(),
          expenseId,
        );
        saveLaborKind(db, expenseId, v.laborKind, new Date().toISOString());
        const saved = getExpense(db, id, expenseId),
          period = costEvent(
            db,
            req,
            bumpCost(db, row),
            "expense_updated",
            v.reason,
            saved,
          );
        return { period, expense: saved };
      },
      () => {
        access(req, true, true);
      },
    );
  });
  for (const action of ["cancel", "restore"] as const)
    app.post(base + "/:expenseId/" + action, (req, res) => {
      access(req, true, true);
      const v = costReason.extend({stockAcknowledgment:stockUnchangedAcknowledgment.optional()}).parse(req.body),
        site = String(req.params.siteId),
        id = String(req.params.id),
        expenseId = String(req.params.expenseId);
      mutate(
        req,
        res,
        `cost:expense:${action}:${site}:${id}:${expenseId}`,
        v,
        () => {
          const row = getCostPeriod(db, site, id);
          expectedCost(row, v.version);
          const old = getExpense(db, id, expenseId);
          assertCostStockAcknowledgment(db,expenseId,v.stockAcknowledgment);
          if (action === "restore") assertSplitRestore(db, expenseId);
          if (old.status !== (action === "cancel" ? "active" : "cancelled"))
            throw new HttpError(409, "지출의 상태가 변경되었습니다.");
          db.prepare(
            "UPDATE cost_expenses SET status=?,version=version+1,updated_at=? WHERE id=?",
          ).run(
            action === "cancel" ? "cancelled" : "active",
            new Date().toISOString(),
            expenseId,
          );
          const saved = getExpense(db, id, expenseId),
            period = costEvent(
              db,
              req,
              bumpCost(db, row),
              "expense_" + action,
              v.reason,
              saved,
            );
          return { period, expense: saved };
        },
        () => {
          access(req, true, true);
        },
      );
    });
}
