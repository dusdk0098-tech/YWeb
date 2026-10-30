import { z } from "zod";
import { date, revision } from "./validation.js";
const short = z.string().trim().min(1).max(200);
export const tbmInput = z
  .object({
    title: short,
    date,
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    location: z.string().trim().max(200),
    facilitator: z.string().trim().max(200),
    work: z.string().trim().max(10000),
    topics: z.string().trim().max(10000),
  })
  .strict();
export type TbmInput = z.infer<typeof tbmInput>;
export const tbmVersion = z.object({ version: revision }).strict();
export const participantAdd = tbmVersion.extend({ workerId: z.uuid() });
export const participantRecord = tbmVersion.extend({
  state: z.enum(["pending", "present", "absent"]),
});
export const tbmRevision = tbmVersion.extend({
  reason: z.string().trim().min(1).max(500),
});

export const tbmFinalDetails = tbmInput.extend({
  location: short,
  facilitator: short,
  work: z.string().trim().min(1).max(10000),
  topics: z.string().trim().min(1).max(10000),
});

export const tbmFinalize = tbmVersion.extend({ acknowledgeHistoricalSource: z.boolean().optional() });
