// Stable semantic keys keep the authored prompts tied to their response fields.
// They are not prescribed regulatory questions or an automatic safety rubric.
export const narrativeQuestionLabels = {
  scenario: "위험 상황",
  exposedGroup: "피해 대상 집단",
  exposurePath: "피해에 이르는 노출 경로",
  harm: "예상 피해",
  currentControls: "현재 조치",
  additionalMeasures: "추가조치 판단",
} as const;
export type NarrativeQuestionKey = keyof typeof narrativeQuestionLabels;

export const narrativeDecisionLabels = {
  planned: "추가조치 계획 제안 (이행 완료 아님)",
  none_proposed: "추가조치 계획 미제안 (안전 판정 아님)",
  further_review: "추가 판단 필요 (판단 미확정)",
} as const;

export function emptyNarrativeQuestions() {
  return {
    scenario: { prompt: "", guidance: "" },
    exposedGroup: { prompt: "", guidance: "" },
    exposurePath: { prompt: "", guidance: "" },
    harm: { prompt: "", guidance: "" },
    currentControls: { prompt: "", guidance: "" },
    additionalMeasures: { prompt: "", guidance: "" },
  };
}
