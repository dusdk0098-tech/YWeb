import { z } from "zod";
import { riskAssessmentInput, riskHazardInput } from "./risk-model.js";
import { HttpError } from "./site-operations.js";
export const threeLevelCriteriaInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    method: z.literal("three_level"),
    rationale: z.string().trim().max(2000),
    levels: z
      .array(
        z
          .object({
            id: z.uuid(),
            label: z.string().trim().max(200),
            description: z.string().trim().max(2000),
            criterionAcceptable: z.boolean(),
          })
          .strict(),
      )
      .length(3),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.levels.map((l) => l.id)).size !== 3)
      ctx.addIssue({
        code: "custom",
        message: "세 단계 ID가 서로 달라야 합니다.",
      });
  });
export type ThreeLevelCriteria = z.infer<typeof threeLevelCriteriaInput>;
export const threeLevelHazardInput = riskHazardInput
  .omit({ likelihood: true, severity: true })
  .extend({ levelId: z.uuid().nullable() });
export const threeLevelAssessmentInput = z
  .object({
    ...riskAssessmentInput.shape,
    method: z.literal("three_level"),
    hazards: z.array(threeLevelHazardInput).max(50),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.hazards.map((h) => h.id)).size !== v.hazards.length)
      ctx.addIssue({ code: "custom", message: "위험행 ID가 중복되었습니다." });
  });
export type ThreeLevelAssessment = z.infer<typeof threeLevelAssessmentInput>;
export function validateThreeLevelCriteria(c: ThreeLevelCriteria) {
  if (
    !c.rationale ||
    c.levels.some((l) => !l.label || !l.description) ||
    new Set(c.levels.map((l) => l.label)).size !== 3
  )
    throw new HttpError(
      400,
      "서로 다른 세 단계 이름·판단 설명과 기준 근거를 입력하세요. 법정 기본값은 없습니다.",
    );
}
export function threeLevelResults(
  body: ThreeLevelAssessment,
  c: ThreeLevelCriteria | null,
) {
  return body.hazards.map((h) => {
    const level =
      h.levelId && c ? c.levels.find((l) => l.id === h.levelId) : null;
    if (h.levelId && !level)
      throw new HttpError(400, "확인된 선택 기준에 속한 단계만 선택하세요.");
    return {
      id: h.id,
      score: null,
      selectionKind: "human_three_level" as const,
      levelId: level?.id ?? null,
      bandLabel: level?.label ?? null,
      criterionAcceptable: level?.criterionAcceptable ?? null,
      incomplete:
        !c || !level || !h.task || !h.scenario || !h.harm || !h.judgmentReason,
      reductionPlanMissing:
        level?.criterionAcceptable === false &&
        !h.plans.some((p) => p.action.trim()),
    };
  });
}
