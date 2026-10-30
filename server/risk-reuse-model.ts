import { randomUUID } from "node:crypto";
import { z } from "zod";
import { methodAssessmentInput, type MethodAssessment } from "./risk-methods.js";
import { HttpError } from "./site-operations.js";
import { revision, date } from "./validation.js";
export const reuseInput = z.object({
  version: revision,
  submissionVersion: revision,
  submissionHash: z.string().regex(/^[a-f0-9]{64}$/),
  hazardIds: z.array(z.uuid()).min(1).max(50),
  includePlans: z.boolean(),
  title: z.string().trim().min(1).max(200),
  date,
  timing: z.enum(["최초", "정기", "수시", "상시"]),
  trigger: z.string().trim().max(2000),
  workScope: z.string().trim().max(2000),
  reason: z.string().trim().min(1).max(1000),
  confirmHistoricalCriteria: z.literal(true),
  confirmReset: z.literal(true),
}).strict().refine(v => new Set(v.hazardIds).size === v.hazardIds.length, "선택 위험행이 중복되었습니다.");
export type ReuseInput = z.infer<typeof reuseInput>;
export function reuseBody(source: MethodAssessment, input: ReuseInput, uuid = randomUUID) {
  const chosen = new Set(input.hazardIds);
  if (chosen.size !== input.hazardIds.length || source.hazards.filter(h => chosen.has(h.id)).length !== chosen.size)
    throw new HttpError(400, "원 제출본의 위험행을 중복 없이 선택하세요.");
  const mapping: { sourceHazardId: string; newHazardId: string }[] = [];
  const hazards = source.hazards.filter(h => chosen.has(h.id)).map(h => {
    const id = uuid();
    mapping.push({ sourceHazardId: h.id, newHazardId: id });
    const base = { ...h, id, judgmentReason: "", plans: input.includePlans ? h.plans.map(p => ({ ...p, ownerNote: "", due: null, priorityNote: "" })) : [] };
    switch (source.method) {
      case "product": return { ...base, likelihood: null, severity: null };
      case "three_level": return { ...base, levelId: null };
      case "checklist": return { ...base, outcome: null };
      case "narrative": return { ...base, additionalPlanDecision: null };
    }
  });
  const body = methodAssessmentInput.parse({ ...source, title: input.title, date: input.date, timing: input.timing, trigger: input.trigger, workScope: input.workScope, hazards });
  return { body, mapping };
}
