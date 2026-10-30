import type { CurrentCostEvidence, fixedCostEvidence } from "../server/cost-evidence-model";
export type CostEvidence = CurrentCostEvidence;
export type CostEvidenceFixed = ReturnType<typeof fixedCostEvidence>;
export const costEvidenceWarning = "미검사 PNG/JPEG/PDF 원본의 참조 기록입니다. 시작 헤더만 확인하므로 손상·위장 파일도 허용될 수 있습니다. 미리보기·악성코드/영수증 적격 검사·금액/수량 배분·실제 외부 제출을 하지 않습니다. 같은 파일의 여러 지출 연결은 각각의 지출을 입증한다는 뜻이 아닙니다.";
