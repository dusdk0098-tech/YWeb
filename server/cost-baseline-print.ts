import { escapeHtml as e } from "./print.js";
import { printCostPeriod } from "./cost-print.js";
import type { CostBaseline, Statement } from "./cost-baseline-model.js";
export function printCostBaseline(b:CostBaseline,hash:string) {
  const supplement=`<section><h2>고정 비용 기준본</h2><p>${e(b.id)} · SHA-256 ${e(hash)}</p><p>생성 ${e(b.createdAt)} · ${e(b.createdBy.name)} (${e(b.createdBy.id)})</p><p>${e(b.memo)}</p><p>마감 출처 ${e(b.closureId)} · ${e(b.closureHash)}</p><p>기준본 생성은 외부 제출·접수 또는 비용 적격성 증명이 아닙니다. 제출 진술 기록과 현재 비교는 이 고정 인쇄에 합치지 않습니다.</p><h3>기준본 당시 분할 계보</h3>${b.splits.map(s=>`<article><p>${e(s.id)} · ${e(s.status)} · 원행 ${e(s.sourceExpenseId)}</p><p>자식 ${s.children.map(e).join(' · ')}</p><p>분할 SHA-256 ${e(s.hash)} · 되돌리기 ${e(s.undoHash||'없음')}</p></article>`).join('')}</section>`;
  return printCostPeriod(b.closure,b.closureHash).replace('</main>',supplement+'</main>');
}
export function printCostStatement(s:Statement,hash:string) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>제출 진술 기록</title><link rel="stylesheet" href="/print.css"></head><body><main><h1>사람이 진술한 제출 기록</h1><p>외부 전송·접수·열람 증명이 아닙니다. 자동 발송하지 않습니다.</p><p>기준본 ${e(s.baselineId)} · ${e(s.baselineHash)}</p><p>기록 ${e(s.id)} · ${s.number} · SHA-256 ${e(hash)}</p><p>진술 제출일 ${e(s.submittedDate)} · 기록 시각 ${e(s.recordedAt)}</p><p>${e(s.actor.name)} (${e(s.actor.id)})</p><p>${e(s.memo)}</p><p>정정 대상 ${e(s.correctsId||'없음')} · 이전 기록은 삭제하거나 덮어쓰지 않습니다.</p></main></body></html>`;
}
