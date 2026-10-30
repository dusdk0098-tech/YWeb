import { z } from "zod";
import { date, revision } from "./validation.js";
export const templateInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    instructions: z.string().trim().max(3000),
    items: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
  })
  .strict();
export const inspectionBody = z
  .object({
    date,
    location: z.string().trim().max(300),
    performedBy: z.string().trim().max(100),
    answers: z
      .array(
        z
          .object({
            itemId: z.uuid(),
            result: z.enum(["pending", "pass", "fail", "na"]),
            comment: z.string().trim().max(2000),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const inspectionVersion = z.object({ version: revision }).strict();
export const inspectionReview = inspectionVersion.extend({
  reason: z.string().trim().min(1).max(1000),
});
export const inspectionReturn = inspectionReview.extend({ authorId: z.uuid() });
export const inspectionPage = z
  .object({ offset: z.coerce.number().int().min(0).max(1000000).default(0) })
  .strict();
export type TemplateBody = {
  title: string;
  instructions: string;
  items: { id: string; text: string }[];
};
export type InspectionBody = z.infer<typeof inspectionBody>;
