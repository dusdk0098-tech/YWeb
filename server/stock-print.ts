import { escapeHtml as h } from "./print.js";
import type { StockItem, StockMovement } from "./stock-model.js";
export function printStock(
  item: StockItem,
  rows: StockMovement[],
  balance: string,
) {
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><title>수기 재고 수불</title><style>body{font-family:sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #888;padding:6px;white-space:pre-wrap}button{margin:8px}@media print{button{display:none}}</style><h1>수기 재고 수불</h1><p>현재 품목 ${h(item.name)} · ${h(item.unit)} · ID ${h(item.id)} · 잔량 ${h(balance)}</p><p>금액 평가/원가/실물 확인/자동 비용 연결이 아닙니다. 효력일과 기록 시각은 다릅니다. 동일 날짜는 순번 순서입니다. 역분개는 과거 행 삭제가 아니라 새 반대 이동입니다.</p><table><thead><tr><th>순번/효력일</th><th>당시 품목/단위</th><th>유형/수량/잔량</th><th>사유/출처</th><th>기록자/시각/해시</th></tr></thead><tbody>${rows
    .map((r) => {
      const s = JSON.parse(r.item_snapshot) as { name: string; unit: string };
      return `<tr><td>${r.sequence}<br>${h(r.effective_date)}</td><td>${h(s.name)} / ${h(s.unit)}</td><td>${h(r.kind)} ${r.direction === 1 ? "+" : "−"}${h(r.quantity)}<br>${h(r.balance_after)}</td><td>${h(r.reason)}<br>${h(r.reverses_id || "")}</td><td>${h(r.actor_name)} (${h(r.actor_id)})<br>${h(r.recorded_at)}<br>${h(r.hash)}</td></tr>`;
    })
    .join(
      "",
    )}</tbody></table><p>이 문서는 현재 조회 당시 보존 이동 전체(상한9000건)를 표시합니다. 일반 원본1000+역분개1000과 PPE 전용 최대7000을 분리합니다. PPE 부분 반납은 사유에 표시된 전용 adjust_in, 취소는 그 원본의 전체 reversal이며 지급 출고를 일부 역분개하지 않습니다. 별도 월마감/증명서가 아닙니다.</p></html>`;
}
