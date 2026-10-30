import type { CostExpense, CostCategory } from "../server/cost-model";
export type { CostExpense, CostCategory };
export type CostPeriod = {
  id: string;
  month: string;
  status: "open" | "closed";
  version: number;
  opening_note: string;
  categories: CostCategory[];
  parent_period_id: string | null;
  source_close_id: string | null;
  successor: { id: string; month: string } | null;
  currentClosure: {
    id: string;
    number: number;
    hash: string;
    closed_at: string;
  } | null;
  totals: {
    byCategory: (CostCategory & {
      current: string;
      cumulative: string;
      remaining: string;
      overPlan: boolean;
    })[];
    total: {
      plan: string;
      opening: string;
      current: string;
      cumulative: string;
      remaining: string;
    };
    activeCount: number;
    cancelledCount: number;
  };
};
export const costWarning =
  "수기 비용 원장 · 법정 인정액·세금·재고 계산이 아닙니다. 수량은 양수 소수 6자리, 단가는 양수 원 단위 정수입니다. 금액은 반올림하지 않습니다.";
