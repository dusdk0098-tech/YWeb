import { z } from "zod";
import { date, revision } from "./validation.js";
export const noticeContent = z
  .object({
    title: z.string().trim().min(1).max(200),
    workScope: z.string().trim().max(1000),
    applyDate: date,
    text: z.string().trim().max(10000),
  })
  .strict();
export const noticeInput = z
  .object({
    content: noticeContent,
    recipientIds: z
      .array(z.uuid())
      .min(1)
      .max(200)
      .refine((v) => new Set(v).size === v.length),
  })
  .strict();
export const noticeVersion = z.object({ version: revision }).strict();
export const noticeReason = noticeVersion.extend({
  reason: z.string().trim().min(1).max(1000),
});
export const noticePage = z
  .object({ offset: z.coerce.number().int().min(0).max(1000000).default(0) })
  .strict();
export type NoticeContent = z.infer<typeof noticeContent>;
