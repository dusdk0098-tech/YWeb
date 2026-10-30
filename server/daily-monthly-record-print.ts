import { escapeHtml as e } from "./print.js";
import { printMonthlyJournals } from "./daily-monthly-print.js";
import type { MonthlyRecord } from "./daily-monthly-record-model.js";
export function printMonthlyRecord(record: MonthlyRecord) {
  const b=record.body;
  // Render only stored content; current source state never changes historical HTML.
  return printMonthlyJournals(b.report).replace("<main>",`<main><header><h1>월간 조회 고정 기록 · 버전 ${b.number}</h1><p>기록 ID ${e(b.id)} · SHA-256 ${e(record.hash)}</p><p>기록자 ${e(b.actor.name)} · ${e(b.recordedAt)}</p><p>기록 사유 ${e(b.reason)}</p><p>이전 기록 ${e(b.parentId||"없음")} · ${e(b.parentHash||"없음")}</p><p>아래는 저장 당시 월간 조회입니다. 누락/미보관/정정 대기를 포함하며 완결·월마감·승인·법정 보고·실제 출역 증명이 아닙니다. 현재 변경 경고는 별도 화면에서 확인하세요.</p></header>`);
}
