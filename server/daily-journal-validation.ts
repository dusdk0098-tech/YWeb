import { inspectionReferences } from "./daily-inspection-references.js";
import { z } from "zod";
import { date, revision } from "./validation.js";
export const dailyBody = z
  .object({
    inspectionReferences: inspectionReferences.optional(),
    workSummary: z.string().trim().max(5000),
    workLocations: z.string().trim().max(1000),
    safetyInstructions: z.string().trim().max(5000),
    observations: z.string().trim().max(5000),
    followupNotes: z.string().trim().max(5000),
    patrols: z
      .array(
        z
          .object({
            location: z.string().trim().min(1).max(200),
            finding: z.string().trim().min(1).max(1000),
            action: z.string().trim().max(1000),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export const dailyCreate = z.object({ date, body: dailyBody }).strict();
export const dailyVersion = z.object({ version: revision }).strict();
export const dailyEdit = dailyVersion.extend({ body: dailyBody });
export const dailyRevise = dailyVersion.extend({
  authorId: z.uuid(),
  reason: z.string().trim().min(1).max(1000),
});
export type DailyBody = z.infer<typeof dailyBody>;
