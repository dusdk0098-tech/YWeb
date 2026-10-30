import type { minimumDetail, minimumPage, StockMinimumSetting } from "../server/stock-minimum-model";
export type MinimumDetail = ReturnType<typeof minimumDetail>;
export type MinimumPage = ReturnType<typeof minimumPage>;
export type MinimumSetting = StockMinimumSetting;
export const minimumLabels = { below: "기준 아래", equal: "기준과 같음", above: "기준 위", disabled: "설정 해제", unset: "미설정", unavailable: "비교 불가" };
export const minimumWarning = "현재 기록 잔량과 관리자가 정한 기준의 비교입니다. 실물·법정 충족, 수요 예측, 월별 과거 재현, 알림 발송 또는 자동 보충이 아닙니다.";
