import type {
  inspectionRecord,
  templateRecord,
} from "../server/inspection-model";
export type Inspection = ReturnType<typeof inspectionRecord>;
export type InspectionTemplate = ReturnType<typeof templateRecord> & {selectionHash?:string};
export type {
  InspectionBody,
  TemplateBody,
} from "../server/inspection-validation";
export const inspectionStatus = {
  draft: "초안",
  submitted: "제출 · 검토 대기",
  accepted: "기록 검토 수락",
  returned: "반려 · 후속 초안 생성",
};
export const resultLabel = {
  pending: "미입력",
  pass: "적합",
  fail: "부적합",
  na: "해당 없음",
};
