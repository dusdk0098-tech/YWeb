import { z } from "zod";
import { riskAssessmentInput, riskHazardInput } from "./risk-model.js";
import { HttpError } from "./site-operations.js";
export const checklistCriteriaInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    method: z.literal("checklist"),
    rationale: z.string().trim().max(2000),
    items: z
      .array(
        z
          .object({
            id: z.uuid(),
            prompt: z.string().trim().max(1000),
            guidance: z.string().trim().max(2000),
          })
          .strict(),
      )
      .max(50),
  })
  .strict()
  .superRefine((v, c) => {
    if (new Set(v.items.map((i) => i.id)).size !== v.items.length)
      c.addIssue({ code: "custom", message: "체크항목 ID가 중복되었습니다." });
  });
export type ChecklistCriteria = z.infer<typeof checklistCriteriaInput>;
export function validateChecklistCriteria(c: ChecklistCriteria) {
  if (
    !c.rationale ||
    !c.items.length ||
    c.items.some((i) => !i.prompt || !i.guidance)
  )
    throw new HttpError(
      400,
      "1–50개 항목의 질문·판단 안내와 기준 근거를 입력하세요. 기본 법정 양식은 없습니다.",
    );
}
export const checklistHazardInput = riskHazardInput
  .omit({ likelihood: true, severity: true })
  .extend({
    checklistItemId: z.uuid().nullable(),
    outcome: z.enum(["compliant", "noncompliant", "not_applicable"]).nullable(),
  });
export const checklistAssessmentInput = z
  .object({
    ...riskAssessmentInput.shape,
    method: z.literal("checklist"),
    hazards: z.array(checklistHazardInput).max(50),
  })
  .strict()
  .superRefine((v, c) => {
    const ids = v.hazards
      .map((h) => h.checklistItemId)
      .filter((id) => id !== null);
    if (
      new Set(v.hazards.map((h) => h.id)).size !== v.hazards.length ||
      new Set(ids).size !== ids.length
    )
      c.addIssue({
        code: "custom",
        message: "위험행/연결 체크항목 ID가 중복되었습니다.",
      });
  });
export type ChecklistAssessment = z.infer<typeof checklistAssessmentInput>;
export const checklistLabels = {
  compliant: "적합 (해당 항목에 대한 사람 판단)",
  noncompliant: "부적합 (해당 항목에 대한 사람 판단)",
  not_applicable: "해당없음 (사유 필요)",
};
export function checklistResults(
  body: ChecklistAssessment,
  c: ChecklistCriteria | null,
) {
  return body.hazards.map((h) => {
    const item =
      h.checklistItemId && c
        ? c.items.find((i) => i.id === h.checklistItemId)
        : null;
    if (h.checklistItemId && !item)
      throw new HttpError(400, "선택 기준의 체크항목을 연결하세요.");
    if (h.outcome && !item)
      throw new HttpError(400, "확인 기준의 체크항목을 연결한 뒤 응답하세요.");
    return {
      id: h.id,
      score: null,
      selectionKind: "human_checklist" as const,
      checklistItemId: item?.id ?? null,
      outcome: h.outcome,
      bandLabel: h.outcome ? checklistLabels[h.outcome] : null,
      criterionAcceptable: null,
      incomplete: !c || !item || !h.outcome || !h.task || !h.judgmentReason,
      reductionPlanMissing:
        h.outcome === "noncompliant" && !h.plans.some((p) => p.action.trim()),
    };
  });
}
export function validateChecklistCoverage(
  body: ChecklistAssessment,
  c: ChecklistCriteria,
) {
  if (
    body.hazards.length !== c.items.length ||
    c.items.some((i) => !body.hazards.some((h) => h.checklistItemId === i.id))
  )
    throw new HttpError(
      400,
      "고정 기준의 모든 체크항목에 정확히 한 응답이 필요합니다. 항목을 생략하여 제출하지 않습니다.",
    );
}
