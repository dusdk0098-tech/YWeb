export type { WorkStopRecord, WorkStopEvent } from "../server/work-stop-model";
export type {
  WorkStopInput,
  WorkStopStatus,
} from "../server/work-stop-validation";
import type { WorkStopStatus } from "../server/work-stop-validation";
export const workStopLabels: Record<WorkStopStatus, string> = {
  requested: "요청 접수 기록",
  acknowledged: "관리자 확인·배정 기록",
  stop_recorded: "중지 수기 기록",
  review_requested: "개선 검토 요청 기록",
  resumption_recorded: "재개 수기 기록",
  closed_without_stop_record: "중지 기록 없이 요청 종결",
};
export const workStopWarning =
  "이 화면은 요청·수기 기록만 보관합니다. 실제 작업중지/재개 명령·안전 허가·긴급 전송이 아닙니다. 긴급 상황은 현장의 실제 대응 절차를 별도로 따르세요.";
