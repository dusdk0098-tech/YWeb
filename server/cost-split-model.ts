import { activeCostReceipt } from "./cost-stock-model.js";
import { z } from "zod";
import type { Db } from "./db.js";
import { costReason, expenseInput } from "./cost-validation.js";
import {
  getExpense,
  type CostExpense,
  type CostPeriodRow,
} from "./cost-model.js";
import { normalizedExpense } from "./cost-expense-input.js";
import { quantityUnits, moneyUnits } from "./cost-money.js";
import { journalHash } from "./daily-journal-sources.js";
import { HttpError } from "./site-operations.js";
export const costSplitInput = costReason.extend({
  children: z
    .array(
      expenseInput.pick({
        description: true,
        quantity: true,
        unitPriceWon: true,
      }),
    )
    .min(2)
    .max(20),
});
export type SplitSnapshot = {
  id: string;
  periodId: string;
  site: { id: string; name: string };
  month: string;
  source: CostExpense;
  children: CostExpense[];
  reason: string;
  actor: { id: string; name: string };
  at: string;
};
export type SplitUndo = {
  actor: { id: string; name: string };
  at: string;
  reason: string;
  restored: CostExpense;
  cancelledChildren: CostExpense[];
};
export type SplitRow = {
  id: string;
  period_id: string;
  source_expense_id: string;
  body: string;
  hash: string;
  status: "active" | "undone";
  undo_snapshot: string | null;
  undo_hash: string | null;
  created_at: string;
};
export function splitRow(db: Db, period: string, id: string) {
  const row = db
    .prepare("SELECT * FROM cost_splits WHERE period_id=? AND id=?")
    .get(period, id) as SplitRow | undefined;
  if (!row) throw new HttpError(404, "분할 기록을 찾을 수 없습니다.");
  return row;
}
export function splitView(row: SplitRow, site: string) {
  const snapshot = JSON.parse(row.body) as SplitSnapshot;
  if (
    journalHash(snapshot) !== row.hash ||
    snapshot.id !== row.id ||
    snapshot.periodId !== row.period_id ||
    snapshot.site.id !== site ||
    snapshot.source.id !== row.source_expense_id
  )
    throw new HttpError(409, "분할 snapshot 자료가 일치하지 않습니다.");
  const undo = row.undo_snapshot
    ? (JSON.parse(row.undo_snapshot) as SplitUndo)
    : null;
  if (undo && journalHash(undo) !== row.undo_hash)
    throw new HttpError(
      409,
      "분할 되돌리기 snapshot 자료가 일치하지 않습니다.",
    );
  return { ...row, snapshot, undo };
}
export function splitChildren(
  source: CostExpense,
  input: z.infer<typeof costSplitInput>,
) {
  const children = input.children.map((c) =>
    normalizedExpense({
      ...c,
      categoryId: source.category_id,
      spendDate: source.spend_date,
    }),
  );
  const quantity = children.reduce(
      (sum, c) => sum + quantityUnits(c.quantity),
      0n,
    ),
    amount = children.reduce((sum, c) => sum + moneyUnits(c.amount), 0n);
  if (
    quantity !== quantityUnits(source.quantity) ||
    amount !== moneyUnits(source.amount)
  )
    throw new HttpError(
      400,
      "자식 수량 합계와 금액 합계가 각각 원행과 정확히 같아야 합니다. 반올림하지 않습니다.",
    );
  return children;
}
function comparable(e: CostExpense) {
  return JSON.stringify([
    e.id,
    e.period_id,
    e.category_id,
    e.spend_date,
    e.description,
    e.quantity,
    e.unit_price_won,
    e.amount,
  ]);
}
export function undoEligibility(
  db: Db,
  row: SplitRow,
  snapshot: SplitSnapshot,
) {
  if (row.status !== "active")
    return {
      allowed: false,
      reason: "이미 되돌린 분할입니다. 자식행은 직접 복원할 수 없습니다.",
    };
  if(db.prepare("SELECT 1 FROM cost_split_children c JOIN cost_stock_receipts r ON r.expense_id=c.expense_id AND r.status='active' WHERE c.split_id=? LIMIT 1").get(row.id)) return {allowed:false,reason:"분할 자식에 활성 연결 입고가 있어 되돌릴 수 없습니다. 입고와 비용은 자동 상쇄하지 않습니다."};
  const parent = getExpense(db, row.period_id, row.source_expense_id);
  if (
    parent.status !== "cancelled" ||
    comparable(parent) !== comparable(snapshot.source)
  )
    return {
      allowed: false,
      reason: "원행 상태/내용이 달라져 되돌릴 수 없습니다. 기록을 확인하세요.",
    };
  for (const child of snapshot.children) {
    const current = getExpense(db, row.period_id, child.id);
    if (
      current.status !== "active" ||
      comparable(current) !== comparable(child)
    )
      return {
        allowed: false,
        reason:
          "자식행이 취소되었거나 내용/항목/날짜/수량/단가가 달라졌습니다. 실제 입력 오류라면 기존 사유 있는 수정/복원으로 원래 값을 기록상 정정한 뒤 다시 확인하세요. 이력은 지우지 않습니다.",
      };
  }
  return {
    allowed: true,
    reason:
      "모든 자식행이 현재 유효하고 고정 분할 내용과 같습니다. 명시적 되돌리기는 새 지출행을 만들지 않습니다.",
  };
}
export function expenseSplitInfo(
  db: Db,
  period: CostPeriodRow,
  expenseId: string,
) {
  const expense = getExpense(db, period.id, expenseId),
    child = db
      .prepare("SELECT split_id FROM cost_split_children WHERE expense_id=?")
      .get(expenseId) as { split_id: string } | undefined,
    active = db
      .prepare(
        "SELECT id FROM cost_splits WHERE source_expense_id=? AND period_id=? AND status='active'",
      )
      .get(expenseId, period.id) as { id: string } | undefined;
  const receipt=activeCostReceipt(db,expenseId);
  return {
    expense,
    ...(receipt ? {stockReceiptId:receipt.id}:{}),
    childOf: child?.split_id || null,
    activeSplitId: active?.id || null,
    canSplit:
      period.status === "open" &&
      expense.status === "active" &&
      !child &&
      !active &&
      !receipt,
  };
}
export function assertSplitRestore(db: Db, expenseId: string) {
  if (
    db
      .prepare(
        "SELECT 1 FROM cost_splits WHERE source_expense_id=? AND status='active'",
      )
      .get(expenseId)
  )
    throw new HttpError(
      409,
      "분할 원행은 직접 복원할 수 없습니다. 분할 이력에서 자식 상태를 확인하고 명시적으로 분할 되돌리기를 사용하세요.",
    );
  if (
    db
      .prepare(
        "SELECT 1 FROM cost_split_children c JOIN cost_splits s ON s.id=c.split_id WHERE c.expense_id=? AND s.status='undone'",
      )
      .get(expenseId)
  )
    throw new HttpError(
      409,
      "되돌린 분할의 자식행은 복원할 수 없습니다. 원행이 복원되어 중복 금액이 생깁니다. 원행 또는 새 실제 지출을 확인하세요.",
    );
}
