import { escapeHtml as e } from "./print.js";
import type { CostSnapshot } from "./cost-model.js";
type Printable = Pick<CostSnapshot, "site" | "period" | "totals" | "expenses"> &
  Partial<Pick<CostSnapshot, "closedAt" | "closedBy" | "reason" | "number" | "settings">>;
export function printCostPeriod(s: Printable, hash: string | null) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${e(s.period.month)} 수기 비용 원장</title><link rel="stylesheet" href="/print.css"></head><body><main><h1>${e(s.period.month)} 수기 비용 원장</h1><p>${e(s.site.name)} · ${e(s.period.id)} · ${hash ? "보존된 마감본" : "미마감 현재 원장"} · v${s.period.version}</p>${hash ? `<p>마감${s.number} · ${e(s.closedAt || "")} · ${e(s.closedBy?.name || "")} (${e(s.closedBy?.id || "")}) · ${e(s.reason || "")}</p><p>SHA-256 ${e(hash)}</p>` : ""}${settingsBlock(s.settings)}<p>전회누계 근거: ${e(s.period.opening_note)} · 이전 원장 ${e(s.period.parent_period_id || "수기 최초")} · 원 마감본 ${e(s.period.source_close_id || "없음")}</p><p>원 단위 금액은 소수6자리까지 그대로 표시합니다. 단가는 양의 정수원,수량은 양수 소수6자리. 반올림하지 않으며 실제 결제/세무/법정 인정액 기준이 아닙니다.</p><h2>계획·누계 (원)</h2><table><thead><tr><th>항목</th><th>계획</th><th>전회누계</th><th>당월</th><th>누계</th><th>잔액</th></tr></thead><tbody>${s.totals.byCategory.map((c) => `<tr><td>${e(c.label)}${c.overPlan ? " (계획초과 표시)" : ""}</td><td>${e(c.plan)}</td><td>${e(c.opening)}</td><td>${e(c.current)}</td><td>${e(c.cumulative)}</td><td>${e(c.remaining)}</td></tr>`).join("")}<tr><th>합계</th><td>${e(s.totals.total.plan)}</td><td>${e(s.totals.total.opening)}</td><td>${e(s.totals.total.current)}</td><td>${e(s.totals.total.cumulative)}</td><td>${e(s.totals.total.remaining)}</td></tr></tbody></table><h2>보존 지출 (취소는 합계 제외)</h2>${s.expenses.map((r) => `<article><h3>${e(r.description)}</h3><p>${e(r.id)} v${r.version} · ${e(r.status)} · ${e(r.spend_date)}${r.spend_date < s.period.month + "-01" ? " (원장월보다 이전 지출일: 이 원장월 집계)" : ""}</p><p>항목 ${e(s.period.categories.find((c) => c.id === r.category_id)?.label || "불일치")} · 수량 ${e(r.quantity)} × 단가 ${e(r.unit_price_won)}원 = ${e(r.amount)}원</p></article>`).join("")}<footer>독립 수기 비용 기록입니다. 법정 비용분류/인정률·한도·세금·임금·환급/음수전표·재고·거래분할·기존자료 이관은 미구현입니다. 금액 보존과 실제 지출 적격성/재고 보존을 혼동하지 않습니다. 계획초과 표시는 계산 결과이지 법적 판단이 아닙니다.</footer></main></body></html>`;
}
// SC 현장 설정 as saved with this period/closure; older closures have none.
function settingsBlock(v: CostSnapshot["settings"]) {
  if (!v) return "";
  const range = (a: string, b: string) => (a ? `${a} ~ ${b}` : "");
  const rows: [string, string][] = [
    ["작성일", v.writtenDate], ["공사명", v.projectName], ["건설업체명", v.contractor], ["소재지", v.location],
    ["대표자", v.representative], ["발주자", v.client], ["공사기간", range(v.projectStart, v.projectEnd)],
    ["내역집계표 공사기간", range(v.summaryStart, v.summaryEnd)], ["공사금액(원)", v.contractAmountWon],
    ["표지공정률(%)", v.coverProgress], ["누계공정률(%)", v.cumulativeProgress], ["계상안전관리비(원)", v.safetyBudgetWon],
    ["작성자", v.author], ["작성확인자", v.reviewer],
  ];
  return `<h2>현장 설정</h2><table><tbody>${rows.map(([k, x]) => `<tr><th>${k}</th><td>${e(x || "미입력")}</td></tr>`).join("")}</tbody></table>`;
}
