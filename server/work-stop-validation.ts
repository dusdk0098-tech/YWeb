import { z } from "zod";
import { date, revision } from "./validation.js";
export const workStopStatus = z.enum([
  "requested",
  "acknowledged",
  "stop_recorded",
  "review_requested",
  "resumption_recorded",
  "closed_without_stop_record",
]);
export const localRecordedTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/)
  .refine(
    (v) => date.safeParse(v.slice(0, 10)).success,
    "실제 날짜와 현장 입력 시각을 입력하세요.",
  );
export const workStopInput = z
  .object({
    work: z.string().trim().min(1).max(300),
    location: z.string().trim().min(1).max(300),
    reason: z.string().trim().min(1).max(4000),
    observedLocal: localRecordedTime,
  })
  .strict();
export const workStopReason = z
  .object({ version: revision, reason: z.string().trim().min(1).max(2000) })
  .strict();
export const workStopAssignment = workStopReason.extend({
  assigneeId: z.uuid(),
});
export const workStopActionTime = workStopReason.extend({
  recordedLocal: localRecordedTime,
});
export const workStopReview = workStopReason.extend({
  improvements: z.string().trim().min(1).max(4000),
  conditions: z.string().trim().min(1).max(4000),
});
export const workStopResumption = workStopActionTime.extend({
  conditions: z.string().trim().min(1).max(4000),
});
export const workStopPage = z
  .object({ offset: z.coerce.number().int().min(0).max(1000000).default(0) })
  .strict();
export const workStopFilter = workStopPage.extend({
  status: workStopStatus.optional(),
});
export type WorkStopInput = z.infer<typeof workStopInput>;
export type WorkStopStatus = z.infer<typeof workStopStatus>;
