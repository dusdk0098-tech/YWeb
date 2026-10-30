import { z } from "zod";
import { date, revision } from "./validation.js";
export const workerInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    affiliation: z.string().trim().min(1).max(100),
    kind: z.enum(["worker", "visitor"]),
  })
  .strict();
export const workerUpdate = workerInput.extend({
  active: z.boolean(),
  version: revision,
});
export const attendanceCreate = z.object({ workerId: z.uuid(), date }).strict();
export const attendanceUpdate = z
  .object({
    status: z.enum(["present", "cancelled"]),
    reason: z.string().trim().min(1).max(500),
    version: revision,
  })
  .strict();
export const attendanceFilter = z
  .object({
    date,
    affiliation: z.string().trim().max(100).optional(),
    offset: z.coerce.number().int().min(0).max(1000000).default(0),
  })
  .strict();
export const workerFilter = z
  .object({
    search: z.string().trim().max(100).default(""),
    active: z.enum(["true", "false"]).optional(),
    offset: z.coerce.number().int().min(0).max(1000000).default(0),
  })
  .strict();
