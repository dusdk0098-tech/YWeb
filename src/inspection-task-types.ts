import type {
  taskRecord,
  taskChain,
} from "../server/inspection-schedule-model";
export type InspectionTask = ReturnType<typeof taskRecord>;
export type TaskResult = {
  record: InspectionTask;
  chain: ReturnType<typeof taskChain>;
};
export const taskStatus = {
  planned: "시작 전 · 수기 계획",
  started: "점검 초안 시작됨 (완료 아님)",
  cancelled: "일정 기록 취소",
};
