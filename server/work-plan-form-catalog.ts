// P-01 1단계: 원본 P 앱 양식사용 체크리스트(원본 시트 1) — the 17 form modules from pedit-p-source src/shared/form-modules.ts
// (FORM_POLICY_VERSION 2026.07.1): titles, original sheets and default requirement. No imports: shared with the client bundle.
// "app" says what this app can write today; calculation modules use the work plan's 장비 계산 (P-02, not engineer-reviewed).
export const FORM_POLICY_VERSION = "FORM-POLICY-2026.07.1";
export type FormRequirement = "REQUIRED" | "RECOMMENDED" | "OPTIONAL";
export const FORM_MODULES = [
  { type: "GENERAL_WORK_PLAN", title: "일반 작업계획", sheet: "원본 시트 2·6", requirement: "REQUIRED", app: "작성 가능(일반 장비 형식)" },
  { type: "EXCAVATOR_WORK_PLAN", title: "굴착기 중량물 취급계획", sheet: "원본 시트 7", requirement: "OPTIONAL", app: "작성 가능(굴착기 형식, 계산 없음)" },
  { type: "GROUND_BEARING_REVIEW", title: "건설기계 지내력 검토", sheet: "원본 시트 3", requirement: "OPTIONAL", app: "장비 계산: 지내력" },
  { type: "PLATE_LOAD_TEST", title: "평판재하시험 기록", sheet: "원본 시트 4", requirement: "OPTIONAL", app: "작성 가능(시험보고서 참조)" },
  { type: "LIFTING_DETAIL", title: "양중 상세계획", sheet: "원본 시트 5", requirement: "OPTIONAL", app: "수기 입력 + 장비 계산: 인양 능력·줄걸이" },
  { type: "PRIME_COMMANDER_APPOINTMENT", title: "원청 작업지휘자 지정서", sheet: "원본 시트 8", requirement: "OPTIONAL", app: "작성 가능(지정 기록)" },
  { type: "SUBCONTRACTOR_COMMANDER_APPOINTMENT", title: "협력업체 작업지휘자 지정서", sheet: "원본 시트 9", requirement: "OPTIONAL", app: "작성 가능(지정 기록)" },
  { type: "SIGNALER_APPOINTMENT", title: "신호수 지정서", sheet: "원본 시트 10", requirement: "OPTIONAL", app: "작성 가능(지정 기록)" },
  { type: "EQUIPMENT_DOCUMENT_PACKET", title: "장비서류 묶음", sheet: "원본 시트 11·12", requirement: "OPTIONAL", app: "작성 가능(장비서류 참조·첨부)" },
  { type: "HAZARD_CONTROL_REFERENCE", title: "위험요인·안전대책 참고", sheet: "원본 시트 13", requirement: "REQUIRED", app: "작성 가능(위험대책 참고)" },
  { type: "PILE_DRIVER_STABILITY", title: "항타기 안정성 참고", sheet: "원본 시트 14", requirement: "OPTIONAL", app: "장비 계산: 지내력" },
  { type: "HYDRAULIC_CRANE_STABILITY", title: "하이드로크레인 안정성 참고", sheet: "원본 시트 15", requirement: "OPTIONAL", app: "장비 계산: 지내력" },
  { type: "CRAWLER_CRANE_STABILITY", title: "크롤러크레인 안정성 참고", sheet: "원본 시트 16", requirement: "OPTIONAL", app: "장비 계산: 지내력" },
  { type: "AERIAL_PLATFORM_STABILITY", title: "고소작업차 안정성 참고", sheet: "원본 시트 17", requirement: "OPTIONAL", app: "장비 계산: 지내력" },
  { type: "TELEHANDLER_STABILITY", title: "붐형지게차 안정성 참고", sheet: "원본 시트 18", requirement: "OPTIONAL", app: "장비 계산: 지내력" },
  { type: "LADDER_TRUCK_STABILITY", title: "사다리차 안정성 참고", sheet: "원본 시트 19", requirement: "OPTIONAL", app: "장비 계산: 지내력" },
  { type: "RIGGING_REFERENCE", title: "달기구 제원 참고", sheet: "원본 시트 20", requirement: "OPTIONAL", app: "장비 계산: 줄걸이·달기구(제원은 직접 입력)" },
] as const satisfies readonly { type: string; title: string; sheet: string; requirement: FormRequirement; app: string }[];
export type FormModuleType = (typeof FORM_MODULES)[number]["type"];
export type FormChoice = { type: FormModuleType; included: boolean; exclusionReason: string; note: string };
export const defaultFormChoices = (): FormChoice[] =>
  FORM_MODULES.map((m) => ({ type: m.type, included: m.requirement === "REQUIRED", exclusionReason: "", note: "" }));
// Original rules: required forms cannot be excluded; excluding a recommended form needs a reason. Returns a Korean message or null.
export function formChoiceProblem(choices: FormChoice[]) {
  if (choices.length !== FORM_MODULES.length || new Set(choices.map((c) => c.type)).size !== FORM_MODULES.length || choices.some((c) => !FORM_MODULES.some((m) => m.type === c.type)))
    return "양식 모듈 종류가 누락되었거나 중복되었습니다.";
  for (const c of choices) {
    const m: { title: string; requirement: FormRequirement } = FORM_MODULES.find((x) => x.type === c.type)!;
    if (m.requirement === "REQUIRED" && !c.included) return `필수 양식(${m.title})은 제외할 수 없습니다.`;
    if (m.requirement === "RECOMMENDED" && !c.included && !c.exclusionReason.trim()) return `권장 양식(${m.title})을 제외하려면 사유를 입력해야 합니다.`;
  }
  return null;
}
