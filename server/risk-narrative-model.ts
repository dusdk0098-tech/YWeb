import { narrativeDecisionLabels } from "./risk-narrative-labels.js";
import { z } from "zod";
import { riskAssessmentInput, riskHazardInput } from "./risk-model.js";
import { HttpError } from "./site-operations.js";

const question = z.object({
  prompt: z.string().trim().max(1000),
  guidance: z.string().trim().max(2000),
}).strict();
export const narrativeCriteriaInput = z.object({
  name: z.string().trim().min(1).max(200),
  method: z.literal("narrative"),
  rationale: z.string().trim().max(2000),
  questions: z.object({
    scenario: question,
    exposedGroup: question,
    exposurePath: question,
    harm: question,
    currentControls: question,
    additionalMeasures: question,
  }).strict(),
}).strict();
export type NarrativeCriteria = z.infer<typeof narrativeCriteriaInput>;
export { emptyNarrativeQuestions } from "./risk-narrative-labels.js";
export function validateNarrativeCriteria(c: NarrativeCriteria) {
  if (!c.rationale || Object.values(c.questions).some((q) => !q.prompt || !q.guidance))
    throw new HttpError(400, "여섯 핵심 내용의 자체 질문·작성 안내와 기준 근거를 입력하세요. 법정 표준 질문이나 정답은 제공하지 않습니다.");
}
export const narrativeHazardInput = riskHazardInput
  .omit({ likelihood: true, severity: true })
  .extend({
    exposurePath: z.string().trim().max(2000),
    additionalPlanDecision: z.enum(["planned", "none_proposed", "further_review"]).nullable(),
  });
export type NarrativeHazard = z.infer<typeof narrativeHazardInput>;
export const narrativeAssessmentInput = z.object({
  ...riskAssessmentInput.shape,
  method: z.literal("narrative"),
  hazards: z.array(narrativeHazardInput).max(50),
}).strict().superRefine((v, c) => {
  if (new Set(v.hazards.map((h) => h.id)).size !== v.hazards.length)
    c.addIssue({ code: "custom", message: "위험행 ID가 중복되었습니다." });
});
export type NarrativeAssessment = z.infer<typeof narrativeAssessmentInput>;
export function narrativeResults(body: NarrativeAssessment, c: NarrativeCriteria | null) {
  return body.hazards.map((h) => ({
    id: h.id,
    score: null,
    selectionKind: "human_narrative" as const,
    additionalPlanDecision: h.additionalPlanDecision,
    bandLabel: h.additionalPlanDecision ? narrativeDecisionLabels[h.additionalPlanDecision] : null,
    criterionAcceptable: null,
    judgmentUnresolved: h.additionalPlanDecision === "further_review",
    incomplete: !c || !h.task || !h.scenario || !h.exposedGroup || !h.exposurePath ||
      !h.harm || !h.currentControls || !h.judgmentReason || !h.additionalPlanDecision,
    reductionPlanMissing: h.additionalPlanDecision === "planned" && !h.plans.some((p) => p.action.trim()),
  }));
}
