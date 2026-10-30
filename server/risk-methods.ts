import {
  narrativeCriteriaInput, narrativeAssessmentInput, narrativeResults, validateNarrativeCriteria,
} from "./risk-narrative-model.js";
import {
  checklistCriteriaInput,
  checklistAssessmentInput,
  checklistResults,
  validateChecklistCriteria,
} from "./risk-checklist-model.js";
import { z } from "zod";
import {
  riskCriteriaInput,
  riskAssessmentInput,
  riskResults,
  validateRiskCriteria,
} from "./risk-model.js";
import {
  threeLevelCriteriaInput,
  threeLevelAssessmentInput,
  threeLevelResults,
  validateThreeLevelCriteria,
} from "./risk-three-level-model.js";
import { HttpError } from "./site-operations.js";
export const methodCriteriaInput = z.discriminatedUnion("method", [
  riskCriteriaInput,
  threeLevelCriteriaInput,
  checklistCriteriaInput,
  narrativeCriteriaInput,
]);
export const methodAssessmentInput = z.discriminatedUnion("method", [
  riskAssessmentInput,
  threeLevelAssessmentInput,
  checklistAssessmentInput,
  narrativeAssessmentInput,
]);
export type MethodCriteria = z.infer<typeof methodCriteriaInput>;
export type MethodAssessment = z.infer<typeof methodAssessmentInput>;
export function validateMethodCriteria(c: MethodCriteria) {
  return c.method === "product"
    ? validateRiskCriteria(c)
    : c.method === "three_level"
      ? validateThreeLevelCriteria(c)
      : c.method === "checklist" ? validateChecklistCriteria(c) : validateNarrativeCriteria(c);
}
export function methodResults(
  body: MethodAssessment,
  c: MethodCriteria | null,
) {
  if (body.method === "narrative") {
    if (c && c.method !== "narrative") throw new HttpError(400, "평가와 기준 방법이 다릅니다. 자동 점수 변환은 없습니다.");
    return narrativeResults(body, c);
  }
  if (body.method === "product") {
    if (c && c.method !== "product")
      throw new HttpError(
        400,
        "평가와 기준 방법이 다릅니다. 자동 점수 변환은 없습니다.",
      );
    return riskResults(body, c);
  }
  if (body.method === "checklist") {
    if (c && c.method !== "checklist")
      throw new HttpError(
        400,
        "평가와 기준 방법이 다릅니다. 자동 점수 변환은 없습니다.",
      );
    return checklistResults(body, c);
  }
  if (c && c.method !== "three_level")
    throw new HttpError(
      400,
      "평가와 기준 방법이 다릅니다. 자동 점수 변환은 없습니다.",
    );
  return threeLevelResults(body, c);
}
export function clearMethodSelections(
  body: MethodAssessment,
): MethodAssessment {
  if (body.method === "narrative") return {
    ...body,
    hazards: body.hazards.map((h) => ({ ...h, scenario: "", exposedGroup: "", exposurePath: "", harm: "", currentControls: "", additionalPlanDecision: null, judgmentReason: "" })),
  };
  return body.method === "product"
    ? {
        ...body,
        hazards: body.hazards.map((h) => ({
          ...h,
          likelihood: null,
          severity: null,
          judgmentReason: "",
        })),
      }
    : body.method === "checklist"
      ? {
          ...body,
          hazards: body.hazards.map((h) => ({
            ...h,
            checklistItemId: null,
            outcome: null,
            judgmentReason: "",
          })),
        }
      : {
          ...body,
          hazards: body.hazards.map((h) => ({
            ...h,
            levelId: null,
            judgmentReason: "",
          })),
        };
}
