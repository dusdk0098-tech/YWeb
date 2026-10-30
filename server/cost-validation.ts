import { z } from "zod";
import { date, revision } from "./validation.js";
import { journalMonth } from "./daily-monthly-report.js";
const numeric = z.string().min(1).max(32),
  reason = z.string().trim().min(1).max(1000);
export const costCreate = z
  .object({
    month: journalMonth,
    openingNote: reason,
    categories: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(100),
            plan: numeric,
            opening: numeric,
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export const costVersion = z.object({ version: revision }).strict();
export const costReason = costVersion.extend({ reason });
export const costBudget = costReason.extend({
  plans: z
    .array(z.object({ categoryId: z.uuid(), plan: numeric }).strict())
    .min(1)
    .max(20),
  openings: z
    .array(z.object({ categoryId: z.uuid(), opening: numeric }).strict())
    .min(1)
    .max(20)
    .optional(),
});
export const expenseInput = z
  .object({
    categoryId: z.uuid(),
    spendDate: date,
    description: z.string().trim().min(1).max(500),
    quantity: numeric,
    unitPriceWon: numeric,
  })
  .strict();
export const expenseCreate = costVersion.extend({ expense: expenseInput });
export const expenseEdit = costReason.extend({ expense: expenseInput });
