import { z } from "zod";
import { date, revision } from "./validation.js";
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const educationFields = z
  .object({
    title: z.string().trim().min(1).max(200),
    courseLabel: z.string().trim().max(200),
    instructor: z.string().trim().max(200),
    date,
    startTime: time,
    endTime: time,
    breakMinutes: z.number().int().min(0).max(1438),
    location: z.string().trim().max(300),
    objectives: z.string().trim().max(5000),
    contents: z.string().trim().max(10000),
  })
  .strict();
export type EducationInput = z.infer<typeof educationFields>;
const clockMinutes = (value: string) =>
  Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
export const scheduledMinutes = (
  v: Pick<EducationInput, "startTime" | "endTime" | "breakMinutes">,
) => clockMinutes(v.endTime) - clockMinutes(v.startTime) - v.breakMinutes;
export function validSchedule(
  v: Pick<EducationInput, "startTime" | "endTime" | "breakMinutes">,
) {
  return scheduledMinutes(v) > 0;
}
export const educationInput = educationFields.refine(validSchedule, {
  message:
    "같은 날짜의 종료 시각이 시작보다 늦고 휴게를 뺀 예정시간이 1분 이상이어야 합니다.",
});
export const educationEdit = educationFields
  .extend({ version: revision })
  .refine(validSchedule, { message: "같은 날의 시각/휴게시간을 확인하세요." });
export const educationVersion = z.object({ version: revision }).strict();
export const educationAdd = educationVersion.extend({ workerId: z.uuid() });
export const educationParticipation = educationVersion
  .extend({
    state: z.enum(["pending", "attended", "absent"]),
    attendedMinutes: z.number().int().min(0).max(1439),
  })
  .refine(
    (v) =>
      v.state === "attended" ? v.attendedMinutes > 0 : v.attendedMinutes === 0,
    { message: "참석은 1분 이상, 미입력/불참은 0분이어야 합니다." },
  );
export const educationRevision = educationVersion.extend({
  reason: z.string().trim().min(1).max(1000),
  authorId: z.uuid(),
});
export const educationArchiveDetails = educationFields
  .extend({
    courseLabel: z.string().trim().min(1).max(200),
    instructor: z.string().trim().min(1).max(200),
    location: z.string().trim().min(1).max(300),
    objectives: z.string().trim().min(1).max(5000),
    contents: z.string().trim().min(1).max(10000),
  })
  .refine(validSchedule);
