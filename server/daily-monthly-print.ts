import { escapeHtml as e } from "./print.js";
import type { MonthlyJournalReport } from "./daily-monthly-report.js";
export function printMonthlyJournals(r: MonthlyJournalReport) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${e(r.month)} 안전업무일지 조회</title><link rel="stylesheet" href="/print.css"></head><body><main><h1>${e(r.month)} 안전업무일지 월간 조회</h1><p>${e(r.site.name)} · 조회 ${e(r.generatedAt)}</p><p>조회 fingerprint ${e(r.fingerprint)} (저장된 월마감본/전자서명 아님)</p><p>달력일 ${r.calendarDays} · 보관본 있는 날짜 ${r.counts.daysWithArchived} · 일지 없는 날짜 ${r.counts.noJournalDays} · 최초 초안만 있는 날짜 ${r.counts.unarchivedRootDays} · 정정 초안 대기 날짜 ${r.counts.pendingCorrectionDays} (보관본 있는 날짜와 중복)</p><p>달력일은 근무일/출근일이 아닙니다. 휴일·공휴일·법정 의무를 판정하지 않습니다. 일지 없음/초안은 미작업·미준수 판정이 아닙니다. 월마감/승인/원장 변경 없이 조회 시점 자료만 보여줍니다.</p>${r.days
    .map((d) => {
      const a = d.archived;
      return `<article><h2>${e(d.date)}</h2>${!d.rootId ? "<p>일지 없음 (실제 작업 여부 불명)</p>" : a ? `<p>선택된 최신 보관본 ${e(a.journalId)} · 정정 순서 ${a.revisionNumber} · 기록 v${a.version} · ${e(a.archivedAt)}</p><p>snapshot SHA-256 ${e(a.hash)}</p><h3>보관 당시 작업 요약</h3><p>${e(a.workSummary)}</p><p>장소 ${e(a.workLocations)} · 수기 순찰 입력 항목 ${a.patrolCount}개 (실제 수행 횟수 아님)</p><p>자료 취합 ${e(a.source.capturedAt)} · fingerprint ${e(a.source.fingerprint)}</p><p>그 날짜의 수기 출역 표시: 근로자 ${a.source.facts.attendance.presentWorkers}, 방문자 ${a.source.facts.attendance.presentVisitors}, 취소 ${a.source.facts.attendance.cancelledRecords} (집계 제외)</p><p>TBM 확정 버전 참조 ${a.source.facts.tbm.length}개 (정정 포함, 개최/참여 횟수 아님)</p>${a.source.facts.tbm.map((t) => `<p>${e(t.title)} · ${e(t.id)} · hash ${e(t.hash)} · 이전 ${e(t.parentId || "없음")} · 당시 후속 ${t.successor ? `${e(t.successor.id)} ${e(t.successor.status)} ${e(t.successor.date)}` : "없음"}</p>`).join("")}` : "<p>보관본 없음 — 초안의 내용/집계를 확정값으로 포함하지 않습니다.</p>"}${d.pendingDraft ? `<p><strong>${d.pendingDraft.kind === "pending_correction" ? "더 새로운 정정 초안 대기 — 위 보관본은 이전 버전" : "최초 일지 초안 미보관"}</strong> · ${e(d.pendingDraft.id)} v${d.pendingDraft.version}</p>` : ""}</article>`;
    })
    .join(
      "",
    )}<footer>일자별 저장 기록 조회일 뿐 전체 현장 실적·고유 근로자 수·임금/시간·교육 이수·서명·안전 인증이 아닙니다. 사람/출역/TBM/순찰 월 합계를 만들지 않습니다. 상세 본문·보관 원본은 단건 일지를 확인하세요. 조회 이후 변경은 새 조회에 반영될 수 있습니다.</footer></main></body></html>`;
}
