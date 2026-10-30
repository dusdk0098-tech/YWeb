export type StockItem = {
  id: string;
  site_id: string;
  name: string;
  unit: string;
  version: number;
  balance: string;
  movementCount: number;
  originalCount: number;
  reversalCount: number;
  ppeReturnMovementCount?: number;
  lastEffectiveDate: string | null;
};
export type StockMovement = {
  costReceiptId?: string;
  id: string;
  sequence: number;
  kind: string;
  quantity: string;
  direction: 1 | -1;
  effective_date: string;
  reason: string;
  reverses_id: string | null;
  reversedBy: string | null;
  ppeRecordId?: string | null;
  actor_id: string;
  actor_name: string;
  recorded_at: string;
  item_snapshot: { name: string; unit: string };
  balance_after: string;
  hash: string;
};
export const stockKinds = {
  opening: "초기 수량",
  receipt: "실제 입고·반납",
  issue: "실제 출고",
  adjust_in: "사유 있는 증가 조정",
  adjust_out: "사유 있는 감소 조정",
  reversal: "원본 전체 역분개",
};
export const stockWarning =
  "관리자 수기 재고 · 실물 검증/금액 평가/자동 비용 연결이 아닙니다. 수량은 양수 소수6자리, 잔량은0~10^9. 효력일은 최근 이동일 이전으로 입력할 수 없습니다.";
