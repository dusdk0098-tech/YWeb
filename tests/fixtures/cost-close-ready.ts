import type { Db } from "../../server/db.js";
// Closing is blocked by 출력 전 확인 errors; give every open ledger synthetic 현장 설정 so older close tests keep their focus.
export const closeReadySettings = {
  writtenDate: "2026-10-31", projectName: "<합성> 공사", contractor: "합성건설", location: "", representative: "",
  client: "", projectStart: "2026-01-01", projectEnd: "2026-12-31", summarySameAsProject: true, summaryStart: "2026-01-01",
  summaryEnd: "2026-12-31", contractAmountWon: "1000000000", coverProgress: "", cumulativeProgress: "",
  safetyBudgetWon: "30000000", author: "작성", reviewer: "확인",
};
export function closeReady(db: Db) {
  db.prepare(
    "INSERT INTO cost_period_settings SELECT id,?,? FROM cost_periods p WHERE status='open' AND NOT EXISTS(SELECT 1 FROM cost_period_settings s WHERE s.period_id=p.id)",
  ).run(JSON.stringify(closeReadySettings), new Date().toISOString());
}
