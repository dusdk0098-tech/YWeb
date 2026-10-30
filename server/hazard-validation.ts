import { z } from "zod";
import { date, revision } from "./validation.js";
export const hazardInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    observedDate: date,
    location: z.string().trim().max(300),
    description: z.string().trim().max(10000),
  })
  .strict();
export const hazardSubmitDetails = hazardInput.extend({
  location: z.string().trim().min(1).max(300),
  description: z.string().trim().min(1).max(10000),
});
export type HazardInput = z.infer<typeof hazardInput>;
export const hazardVersion = z.object({ version: revision }).strict();
export const hazardReason = hazardVersion.extend({
  reason: z.string().trim().min(1).max(1000),
});
export const hazardAssignment = hazardReason.extend({
  assigneeId: z.uuid(),
  dueDate: date,
});
export const hazardRemediation = hazardVersion.extend({
  text: z.string().trim().min(1).max(10000),
});
export const hazardList = z
  .object({
    offset: z.coerce.number().int().min(0).max(1000000).default(0),
    status: z
      .enum(["draft", "reported", "assigned", "review_requested", "closed"])
      .optional(),
  })
  .strict();
