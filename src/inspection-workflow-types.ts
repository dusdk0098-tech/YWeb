import type {inspectionTasksRegister,inspectionTemplatesRegister,inspectionRecordsRegister} from "../server/inspection-register";
export type TaskRegisterPage=ReturnType<typeof inspectionTasksRegister>;
export type TemplateRegisterPage=ReturnType<typeof inspectionTemplatesRegister>;
export type InspectionRegisterPage=ReturnType<typeof inspectionRecordsRegister>;
export const inspectionStages:Record<string,string>={planned:"시작 대기",draft:"작성 중",submitted:"제출 · 검토 대기",accepted:"기록 검토 수락",cancelled:"일정 취소",unknown:"현재 단계 판정보류"};
