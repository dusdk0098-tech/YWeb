import { hazardReferences, completeHazardReferences } from "./work-plan-hazard-references.js";
import { liftingDetail, completeLifting } from "./work-plan-lifting.js";
import { plateLoadReports, completePlateReports } from "./work-plan-plate-reports.js";
import { designationRecords, completeDesignations } from "./work-plan-designations.js";
import { planPacketSchema, completePacket } from "./work-plan-packet-schema.js";
import { workPlanForm, completePlanForm } from "./work-plan-forms.js";
import { z } from "zod";
import { date, revision } from "./validation.js";
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  text = (max: number) => z.string().trim().max(max);
export const workPlanFields = z
  .object({
    title: text(200).min(1),
    date,
    startTime: time,
    endTime: time,
    location: text(300),
    workDescription: text(5000),
    emergencyProcedure: text(3000),
    verificationNote: text(2000),
    steps: z
      .array(
        z
          .object({
            task: text(500),
            procedure: text(1500),
            precaution: text(1500),
          })
          .strict(),
      )
      .max(20),
    equipmentIds: z.array(z.uuid()).max(10),
    documentPacket: planPacketSchema.optional(),
    designationRecords: designationRecords.optional(),
    plateLoadReports: plateLoadReports.optional(),
    liftingDetail: liftingDetail.optional(),
    hazardReferences: hazardReferences.optional(),
    documentForm: workPlanForm.optional(),
    duties: z
      .array(z.object({ workerId: z.uuid(), duty: text(1000).min(1) }).strict())
      .max(10),
  })
  .strict();
export type WorkPlanBody = z.infer<typeof workPlanFields>;
export function planMinutes(v: Pick<WorkPlanBody, "startTime" | "endTime">) {
  const minute = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  return minute(v.endTime) - minute(v.startTime);
}
function valid(v: WorkPlanBody) {
  return (
    planMinutes(v) > 0 &&
    new Set(v.equipmentIds).size === v.equipmentIds.length &&
    new Set(v.duties.map((x) => x.workerId)).size === v.duties.length
  );
}
export const workPlanBody = workPlanFields.refine(valid, {
  message:
    "같은 날 종료시각이 시작보다 늦어야 하며 장비/명부를 중복 선택할 수 없습니다.",
});
export const workPlanCreate = z.object({ body: workPlanBody }).strict(),
  workPlanVersion = z.object({ version: revision }).strict(),
  workPlanEdit = workPlanVersion.extend({ body: workPlanBody }),
  workPlanRevision = workPlanVersion.extend({
    reason: text(1000).min(1),
    authorId: z.uuid(),
  });
export function completePlan(v: WorkPlanBody) {
  return (
    (!v.hazardReferences || completeHazardReferences(v.hazardReferences)) &&
    (!v.liftingDetail || completeLifting(v.liftingDetail)) &&
    (!v.plateLoadReports || completePlateReports(v.plateLoadReports)) &&
    (!v.designationRecords || completeDesignations(v.designationRecords)) &&
    (!v.documentPacket || completePacket(v.documentPacket)) &&
    (!v.documentForm || completePlanForm(v.documentForm)) &&
    !!v.location &&
    !!v.workDescription &&
    !!v.emergencyProcedure &&
    v.steps.length > 0 &&
    v.steps.every((s) => s.task && s.procedure && s.precaution)
  );
}
