import { z } from "zod";
import { createHash } from "node:crypto";
import { date } from "./validation.js";
import { HttpError } from "./site-operations.js";
const text = z.string().trim().max(2000);
export const riskCriteriaInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    method: z.literal("product"),
    likelihood: z.array(z.string().trim().max(500)).min(1).max(5),
    severity: z.array(z.string().trim().max(500)).min(1).max(4),
    bands: z
      .array(
        z
          .object({
            min: z.number().int().min(1).max(20),
            max: z.number().int().min(1).max(20),
            label: z.string().trim().max(200),
            criterionAcceptable: z.boolean(),
          })
          .strict(),
      )
      .max(20),
    rationale: text,
  })
  .strict();
export type RiskCriteria = z.infer<typeof riskCriteriaInput>;
export function validateRiskCriteria(v: RiskCriteria) {
  if (
    !v.rationale ||
    [...v.likelihood, ...v.severity].some((x) => !x) ||
    !v.bands.length
  )
    throw new HttpError(
      400,
      "척도 설명·기준 근거·구간을 모두 입력하세요. 기본 법정 기준은 제공하지 않습니다.",
    );
  const max = v.likelihood.length * v.severity.length;
  const sorted = [...v.bands].sort((a, b) => a.min - b.min);
  sorted.forEach((b, i) => {
    if (
      !b.label ||
      b.max < b.min ||
      b.max > max ||
      (i > 0 && sorted[i - 1].max >= b.min)
    )
      throw new HttpError(400, "구간 이름/범위/중복을 확인하세요.");
  });
  for (let l = 1; l <= v.likelihood.length; l++)
    for (let s = 1; s <= v.severity.length; s++)
      if (sorted.filter((b) => b.min <= l * s && b.max >= l * s).length !== 1)
        throw new HttpError(
          400,
          "가능한 모든 곱 점수에 정확히 한 구간이 필요합니다.",
        );
}
const plan = z
  .object({
    action: text,
    controlType: z.enum(["제거", "대체", "공학적", "관리적", "보호구", "미정"]),
    ownerNote: z.string().trim().max(200),
    due: date.nullable(),
    priorityNote: z.string().trim().max(200),
    preconditions: text,
  })
  .strict();
export const riskHazardInput = z
  .object({
    id: z.uuid(),
    task: text,
    location: z.string().trim().max(300),
    category: z.string().trim().max(200),
    accidentType: z.string().trim().max(200),
    scenario: text,
    harm: text,
    exposedGroup: z.string().trim().max(300),
    reference: text,
    currentControls: text,
    likelihood: z.number().int().min(1).max(5).nullable(),
    severity: z.number().int().min(1).max(4).nullable(),
    judgmentReason: text,
    plans: z.array(plan).max(10),
  })
  .strict();
export const riskAssessmentInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    date,
    timing: z.enum(["최초", "정기", "수시", "상시"]),
    trigger: text,
    workScope: text,
    method: z.literal("product"),
    hazards: z.array(riskHazardInput).max(50),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.hazards.map((h) => h.id)).size !== v.hazards.length)
      ctx.addIssue({ code: "custom", message: "위험행 ID가 중복되었습니다." });
  });
export type RiskAssessmentInput = z.infer<typeof riskAssessmentInput>;
export function riskResults(
  body: RiskAssessmentInput,
  criteria: RiskCriteria | null,
) {
  return body.hazards.map((h) => {
    if (
      criteria &&
      ((h.likelihood !== null && h.likelihood > criteria.likelihood.length) ||
        (h.severity !== null && h.severity > criteria.severity.length))
    )
      throw new HttpError(400, "선택 기준의 척도 범위를 벗어난 값입니다.");
    if (!criteria && (h.likelihood !== null || h.severity !== null))
      throw new HttpError(400, "확인된 기준을 선택한 후 값을 입력하세요.");
    const score =
      criteria && h.likelihood !== null && h.severity !== null
        ? h.likelihood * h.severity
        : null;
    const band =
      score === null
        ? null
        : criteria!.bands.find((b) => b.min <= score && b.max >= score)!;
    return {
      id: h.id,
      score,
      bandLabel: band?.label ?? null,
      criterionAcceptable: band?.criterionAcceptable ?? null,
      incomplete:
        !criteria ||
        score === null ||
        !h.task ||
        !h.scenario ||
        !h.harm ||
        !h.judgmentReason,
      reductionPlanMissing:
        band?.criterionAcceptable === false &&
        !h.plans.some((p) => p.action.trim()),
    };
  });
}
export const riskHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
