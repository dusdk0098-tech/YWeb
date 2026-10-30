import type { z } from "zod";
import { expenseInput } from "./cost-validation.js";
import {
  decimalText,
  quantityUnits,
  unitPrice,
  lineAmount,
} from "./cost-money.js";
import {
  lastCostDate,
  type CostCategory,
  type CostPeriodRow,
} from "./cost-model.js";
import { HttpError } from "./site-operations.js";
export function normalizedExpense(v: z.infer<typeof expenseInput>) {
  const quantity = decimalText(quantityUnits(v.quantity)),
    unitPriceWon = unitPrice(v.unitPriceWon).toString();
  return {
    ...v,
    quantity,
    unitPriceWon,
    amount: lineAmount(quantity, unitPriceWon),
  };
}
export function validForPeriod(
  row: CostPeriodRow,
  expense: ReturnType<typeof normalizedExpense>,
) {
  if (
    !(JSON.parse(row.categories) as CostCategory[]).some(
      (c) => c.id === expense.categoryId,
    )
  )
    throw new HttpError(400, "이 원장의 비용 항목을 선택하세요.");
  if (expense.spendDate > lastCostDate(row.month))
    throw new HttpError(
      400,
      "지출일은 원장 월의 마지막 날보다 이후일 수 없습니다.",
    );
}
