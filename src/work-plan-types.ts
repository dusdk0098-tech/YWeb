import type { fullWorkPlan, workPlanRecord } from "../server/work-plan-model";
export type WorkPlan = ReturnType<typeof fullWorkPlan>;
export type WorkPlanListItem = ReturnType<typeof workPlanRecord>;
export type { WorkPlanBody } from "../server/work-plan-validation";
export const workPlanWarning =
  "자체 수기 일반 작업계획 · 작업허가/공학 검토/안전 인증/선임장/근로자 동의·서명이 아닙니다. 두 전용 입력형식 일부를 지원하나17종 전체/계산/원본 페이지 동등성은 미구현입니다.";
