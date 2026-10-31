import type { Express } from "express";
import type { Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { costPeriodView, getCostPeriod, type CostCategory } from "./cost-model.js";
import { moneyUnits, decimalText } from "./cost-money.js";
import { percentText } from "./cost-dashboard.js";
import { escapeHtml as e } from "./print.js";
// 법정 서식 A안 1단계 (docs/LEGAL_FORMS_PROPOSAL.md): 표지·내역집계표·사용내역(갑)·총괄 as HTML,
// same document order, page capacity and values as the original PEDIT-SC (src/excel-summary-settings.js).
// Only structural labels come from the original template; its leftover sample values are not copied.
const SUMMARY_MONTH_CAPACITY = 16;
const SUMMARY_CODES = [1, 2, 3, 4, 5, 6, 7, 9] as const; // original 내역집계표 has no 8번(본사) column
const SUMMARY_HEADS = ["1.인건비등", "2.시설비등", "3.보호구등", "4.안전진단비", "5.교육비등", "6.건강관리비등", "7.기술지도비등", "9.위험성평가"];
function byCode<T extends CostCategory & { current?: string }>(categories: T[]) {
  const unmapped = categories.filter((c) => !c.scCode);
  if (!categories.some((c) => c.scCode))
    throw new HttpError(409, "SC 9개 항목(현장 설정의 SC 채우기)으로 만든 원장만 법정 서식으로 출력할 수 있습니다.");
  if (unmapped.some((c) => [c.plan, c.opening, c.current].some((v) => v && moneyUnits(v) !== 0n)))
    throw new HttpError(409, `SC 항목 번호가 없는 항목(${unmapped.map((c) => c.label).join(", ")})에 금액이 있어 법정 서식으로 출력할 수 없습니다.`);
  return new Map(categories.filter((c) => c.scCode).map((c) => [c.scCode!, c]));
}
const won = (v: bigint | string) => {
  const t = typeof v === "string" ? v : decimalText(v), [i, f] = t.split(".");
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? "." + f : "");
};
const krMonth = (m: string) => `${m.slice(0, 4)}년 ${m.slice(5, 7)}월`;
const shortDate = (d: string) => (d ? d.slice(2).replaceAll("-", ".") : "");
export function legalForms(db: Db, site: string, id: string) {
  const view = costPeriodView(db, getCostPeriod(db, site, id)), s = view.settings, codes = byCode(view.totals.byCategory);
  if (!s) throw new HttpError(409, "현장 설정을 입력한 뒤 출력하세요.");
  const budget = moneyUnits(s.safetyBudgetWon || "0");
  // 내역집계표: every ledger month of this site up to this month, current amount per SC code.
  const periods = db.prepare("SELECT * FROM cost_periods WHERE site_id=? AND month<=? ORDER BY month").all(site, view.month) as Parameters<typeof costPeriodView>[1][];
  let grand = 0n, code8 = 0n;
  const columnTotals = new Map<number, bigint>(SUMMARY_CODES.map((c) => [c, 0n]));
  const months = periods.map((p) => {
    const m = byCode(costPeriodView(db, p).totals.byCategory), amounts = SUMMARY_CODES.map((c) => moneyUnits(m.get(c)?.current ?? "0"));
    code8 += moneyUnits(m.get(8)?.current ?? "0");
    amounts.forEach((a, i) => columnTotals.set(SUMMARY_CODES[i], columnTotals.get(SUMMARY_CODES[i])! + a));
    const total = amounts.reduce((a, b) => a + b, 0n);
    grand += total;
    return { month: p.month, amounts, total };
  });
  const rows = [...codes.values()].sort((a, b) => a.scCode! - b.scCode!), t = view.totals.total;
  return { view, s, budget, months, grand, code8, columnTotals, rows, t, codes };
}
export function printLegalForms(f: ReturnType<typeof legalForms>) {
  const { view, s, budget, months, grand, code8, columnTotals, rows, t } = f,
    ratio = (v: string | bigint) => percentText(typeof v === "string" ? moneyUnits(v) : v, budget),
    pct = (v: string | null) => (v === null ? "-" : v + "%"),
    progress = s.cumulativeProgress ? moneyUnits(s.cumulativeProgress) : 0n,
    standard = budget * progress / 100_000_000n; // 계상액 × 누계공정률(%) / 100, ×10^6 units
  const pages: (typeof months)[] = [];
  for (let i = 0; i < Math.max(1, months.length); i += SUMMARY_MONTH_CAPACITY) pages.push(months.slice(i, i + SUMMARY_MONTH_CAPACITY));
  const cover = `<section class="form-page"><h1>산업안전보건관리비 사용내역</h1><p>표지공정률 ${e(s.coverProgress ? s.coverProgress + "%" : "미입력")}</p><p>${e(krMonth(view.month))}</p><h2>${e(s.projectName)}</h2></section>`;
  const summary = pages.map((page, n) => `<section class="form-page"><h1>산업안전보건관리비 사용 내역 집계표${pages.length > 1 ? ` (${n + 1}/${pages.length})` : ""}</h1>
<p>▶ 공 사 명 : ${e(s.projectName)}</p><p>▶ 공사기간 : ${e(s.summaryStart ? `${s.summaryStart} ~ ${s.summaryEnd}` : `${s.projectStart} ~ ${s.projectEnd}`)}</p>
<table><tbody><tr><th>계상된안전관리비</th><td>${won(budget)}</td><th>도 급 공 사 비</th><td>${won(s.contractAmountWon || "0")}</td></tr>
<tr><th>안전관리비사용률</th><td>${pct(ratio(grand))}</td><th>공사공정률</th><td>${e(s.cumulativeProgress ? s.cumulativeProgress + "%" : "미입력")}</td></tr></tbody></table>
<table><thead><tr><th rowspan="2">구 분</th><th colspan="8">사 용 내 역</th><th rowspan="2">월 별 소 계</th></tr><tr>${SUMMARY_HEADS.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>
${page.map((m) => `<tr><th>${krMonth(m.month)}</th>${m.amounts.map((a) => `<td>${won(a)}</td>`).join("")}<td>${won(m.total)}</td></tr>`).join("")}
<tr><th>계</th>${SUMMARY_CODES.map((c) => `<td>${won(columnTotals.get(c)!)}</td>`).join("")}<td>${won(grand)}</td></tr>
<tr><th>적용료</th><td colspan="8"></td><td>0</td></tr><tr><th>적용금액</th><td colspan="8"></td><td>${won(grand)}</td></tr></tbody></table>
${code8 ? `<p>원본 양식과 같이 8번(본사) 열이 없습니다. 8번 사용액 ${won(code8)}원은 이 표의 합계에 포함되지 않습니다.</p>` : ""}</section>`).join("");
  const gap = `<section class="form-page"><p>[별지 제1호 서식]</p><h1>산업안전보건관리비 사용내역서(${view.month.slice(2, 4)}년 ${view.month.slice(5, 7)}월)</h1>
<table><tbody><tr><th>건설업체명</th><td>${e(s.contractor)}</td><th>공사명</th><td>${e(s.projectName)}</td></tr>
<tr><th>소재지</th><td>${e(s.location)}</td><th>대 표 자</th><td>${e(s.representative)}</td></tr>
<tr><th>공사금액(전체)</th><td>${won(s.contractAmountWon || "0")}</td><th>공사기간(전체)</th><td>${e(`${shortDate(s.projectStart)} ~ ${shortDate(s.projectEnd)}`)}</td></tr>
<tr><th>발주자</th><td>${e(s.client)}</td><th>누계공정율(전체)</th><td>${e(s.cumulativeProgress ? s.cumulativeProgress + "%" : "미입력")}</td></tr>
<tr><th>계상된 안전관리비(전체)</th><td>${won(budget)}</td><th>공사진척도에 따른 사용기준금액(전체)</th><td>${won(standard)}</td></tr></tbody></table>
<h2>사 용 금 액</h2><table><thead><tr><th>항 목</th><th>전월누계</th><th>당월금액</th><th>비율(%)</th><th>누계</th></tr></thead><tbody>
<tr><th>계</th><td>${won(t.opening)}</td><td>${won(t.current)}</td><td>${pct(ratio(t.cumulative))}</td><td>${won(t.cumulative)}</td></tr>
${rows.map((c) => `<tr><th>${c.scCode}. ${e(c.label)}</th><td>${won(c.opening)}</td><td>${won(c.current)}</td><td>${pct(ratio(c.cumulative))}</td><td>${won(c.cumulative)}</td></tr>`).join("")}</tbody></table>
<p>건설업 표준안전관리비계상 및 사용기준 고시 제10조 1항 규정에 의하여 위와같이 사용내역을 제출합니다.</p>
<p>${s.writtenDate ? `${s.writtenDate.slice(0, 4)} 년 ${s.writtenDate.slice(5, 7)}월 ${s.writtenDate.slice(8, 10)}일` : "작성일 미입력"}</p>
<p>작성자 · 안전관리자 · 성명 : ${e(s.author)} (인)</p><p>작성 확인자 · 직급 : 현장 대리인 · 성명 : ${e(s.reviewer)} (인)</p></section>`;
  const overall = `<section class="form-page"><h1>산업안전보건관리비 사용금액 총괄현황</h1><p>공사명 : ${e(s.projectName)}</p>
<table><thead><tr><th rowspan="2">사 용 항 목</th><th rowspan="2">계 획 금 액</th><th colspan="3">사 용 금 액</th><th rowspan="2">잔 액</th><th rowspan="2">비 고</th></tr>
<tr><th>전회까지</th><th>금회금액</th><th>소 계(누계금액)</th></tr></thead><tbody>
<tr><th>계</th><td>${won(t.plan)}</td><td>${won(t.opening)}</td><td>${won(t.current)}</td><td>${won(t.cumulative)}</td><td>${won(t.remaining)}</td><td></td></tr>
${rows.map((c) => `<tr><th>${c.scCode}. ${e(c.label)}</th><td>${won(c.plan)}</td><td>${won(c.opening)}</td><td>${won(c.current)}</td><td>${won(c.cumulative)}</td><td>${won(c.remaining)}</td><td></td></tr>`).join("")}</tbody></table>
<p>※ 첨부：사용항목별 세부내역 (양식 별첨)</p></section>`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${e(view.month)} 산업안전보건관리비 법정 서식</title><link rel="stylesheet" href="/print.css"></head><body><main>
<p class="form-note">${view.status === "open" ? "작성 중 원장의 현재 값입니다. 마감 후 다시 출력하세요." : "마감 원장 기준입니다."} 원본 엑셀 양식의 문서 순서·값을 HTML로 재현했으며 모양은 근사입니다. 법적 적합성 판단이 아닙니다.</p>
${cover}${summary}${gap}${overall}</main></body></html>`;
}
export function registerLegalForms(app: Express, db: Db, { access }: SiteOperations) {
  app.get("/api/sites/:siteId/cost-periods/:id/legal-forms/print", (req, res) => {
    access(req, true, true);
    res.type("html").send(printLegalForms(legalForms(db, String(req.params.siteId), String(req.params.id))));
  });
}
