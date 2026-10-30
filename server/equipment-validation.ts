import { z } from "zod";
import { date, revision } from "./validation.js";
const code = z
  .string()
  .max(120)
  .transform((v) => v.normalize("NFKC").trim())
  .pipe(
    z
      .string()
      .max(60)
      .regex(/^(?:[A-Za-z0-9][A-Za-z0-9._-]*)?$/),
  )
  .transform((v) => v.toUpperCase());
export const equipmentInput = z
  .object({
    assetCode: code,
    name: z.string().trim().min(1).max(200),
    typeLabel: z.string().trim().min(1).max(100),
    model: z.string().trim().max(100),
    serial: z
      .string()
      .max(200)
      .transform((v) => v.normalize("NFKC").trim())
      .pipe(z.string().max(100)),
    ownerCompany: z.string().trim().max(100),
    notes: z.string().trim().max(2000),
  })
  .strict();
export const equipmentReason = z
  .object({ version: revision, reason: z.string().trim().min(1).max(1000) })
  .strict();
export const equipmentEdit = equipmentInput.extend(equipmentReason.shape);
export const equipmentStatus = equipmentReason.extend({
  status: z.enum(["active", "retired"]),
});
export const equipmentUseBody = z
  .object({
    date,
    location: z.string().trim().min(1).max(300),
    workSummary: z.string().trim().min(1).max(3000),
  })
  .strict();
export const equipmentUseCreate = z
  .object({ equipmentId: z.uuid(), body: equipmentUseBody })
  .strict();
export const equipmentUseEdit = equipmentReason.extend({
  body: equipmentUseBody,
  status: z.enum(["recorded", "cancelled"]),
});
export const equipmentPage = z
  .object({ offset: z.coerce.number().int().min(0).max(1000000).default(0) })
  .strict();
export const equipmentFilter = equipmentPage.extend({
  status: z.enum(["active", "retired"]).optional(),
});
export const equipmentUseFilter = equipmentPage.extend({
  equipmentId: z.uuid().optional(),
  date: date.optional(),
});
export type EquipmentInput = z.infer<typeof equipmentInput>;
export type EquipmentUseBody = z.infer<typeof equipmentUseBody>;
