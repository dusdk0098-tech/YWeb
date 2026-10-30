import { DailyMonthlyRecords } from "./DailyMonthlyRecords";
import { useEffect, useState, useCallback } from "react";
import { api, type Site } from "./api";
import type { MonthlyJournalReport } from "../server/daily-monthly-report";
export function DailyMonthlyReport({
  site,
  month,
  onMonth,
  onOpen,
  onClose,
  busy,
  parentError,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  month: string;
  onMonth: (v: string) => void;
  onOpen: (id: string) => void;
  onClose: () => void;
  busy: boolean;
  parentError: string;
  onDirtyChange?: (v: boolean) => void;
  onBusyChange?: (v: boolean) => void;
}) {
  const [report, setReport] = useState<MonthlyJournalReport | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [tick, setTick] = useState(0);
  const [recordDirty, setRecordDirty] = useState(false), [recordBusy, setRecordBusy] = useState(false);
  const recordDirtyChange = useCallback((v:boolean) => {setRecordDirty(v);onDirtyChange?.(v);}, [onDirtyChange]);
  const recordBusyChange = useCallback((v:boolean) => {setRecordBusy(v);onBusyChange?.(v);}, [onBusyChange]);
  const blocked = busy || recordDirty || recordBusy;
  useEffect(() => {
    let active = true;
    setReport(null);
    setError("");
    if (!month) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api<MonthlyJournalReport>(
      `/sites/${site.id}/daily-journal-months?month=${encodeURIComponent(month)}`,
    )
      .then((r) => {
        if (active) setReport(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [site.id, month, tick]);
  return (
    <section className="panel">
      <div className="section-head">
        <h2>안전업무일지 월간 조회 · 읽기 전용</h2>
        <button className="secondary" disabled={blocked} onClick={onClose}>
          일지 목록으로
        </button>
      </div>
      <p className="notice">
        날짜별 최신 보관본만 읽습니다. 새 정정 초안이 있으면 이전 보관본과 함께
        미해결 상태를 표시합니다. 월마감/승인/새 snapshot을 만들지 않습니다.
        달력일은 근무일이 아니며 누락은 미작업·위법 판정이 아닙니다.
      </p>
      <div className="actions">
        <label>
          조회할 달력 월
          <input
            type="month"
            disabled={blocked}
            value={month}
            onChange={(e) => onMonth(e.target.value)}
          />
        </label>
        <button
          className="secondary"
          disabled={blocked || loading || !month}
          onClick={() => setTick((v) => v + 1)}
        >
          월간 자료 다시 조회
        </button>
      </div>
      {(error || parentError) && (
        <p role="alert" className="error">
          {error || parentError}
        </p>
      )}
      {loading && <p>월간 자료 조회 중…</p>}
      {report && (
        <>
          <p>
            {report.site.name} · {report.month} · 조회 {report.generatedAt}
          </p>
          <p>
            달력일 {report.calendarDays} · 보관본 있는 날짜{" "}
            {report.counts.daysWithArchived} · 일지 없는 날짜{" "}
            {report.counts.noJournalDays} · 최초 초안만 있는 날짜{" "}
            {report.counts.unarchivedRootDays} · 정정 초안 대기 날짜{" "}
            {report.counts.pendingCorrectionDays} (보관본 있는 날짜와 중복)
          </p>
          <p className="muted">
            조회 fingerprint {report.fingerprint} · 저장된 월마감본/전자서명이
            아닙니다.
          </p>
          <a
            className="button secondary"
            href={`/api/sites/${site.id}/daily-journal-months/print?month=${encodeURIComponent(report.month)}&expectedFingerprint=${report.fingerprint}`}
            target="_blank"
            rel="noreferrer"
          >
            현재 조회 기준 월간 인쇄
          </a>
          <p className="muted">
            인쇄 전 관련 기록이 바뀌면409로 중단합니다. 다시 조회하세요. 단건
            보관본은 불변이지만 월간 선택 결과는 이후 정정 보관에 따라
            달라집니다.
          </p>
          <DailyMonthlyRecords key={`${site.id}:${report.month}:${report.fingerprint}`} site={site} report={report} onDirtyChange={recordDirtyChange} onBusyChange={recordBusyChange}/>
          {report.days.map((d) => (
            <article key={d.date}>
              <h3>{d.date}</h3>
              {!d.rootId ? (
                <p>일지 없음 (실제 작업 여부 불명)</p>
              ) : d.archived ? (
                <>
                  <p>
                    최신 보관본 {d.archived.journalId} · 정정 순서{" "}
                    {d.archived.revisionNumber} · 기록v{d.archived.version}
                  </p>
                  <p className="prose">{d.archived.workSummary}</p>
                  <p>
                    장소 {d.archived.workLocations} · 수기 순찰 입력 항목{" "}
                    {d.archived.patrolCount}개 (실제 수행 횟수 아님)
                  </p>
                  <p>
                    보관된 해당일 수기 출역 표시: 근로자{" "}
                    {d.archived.source.facts.attendance.presentWorkers} · 방문자{" "}
                    {d.archived.source.facts.attendance.presentVisitors} · 취소{" "}
                    {d.archived.source.facts.attendance.cancelledRecords} (집계
                    제외)
                  </p>
                  <p>
                    TBM 확정 버전 참조 {d.archived.source.facts.tbm.length}개
                    (정정 포함, 개최/참여 횟수 아님)
                  </p>
                  <p className="muted">
                    자료 취합 {d.archived.source.capturedAt} · snapshot SHA-256{" "}
                    {d.archived.hash}
                  </p>
                  <details>
                    <summary>보관된 TBM 참조 ID/해시</summary>
                    {d.archived.source.facts.tbm.map((t) => (
                      <p key={t.id}>
                        {t.title} · {t.id} · {t.hash}
                      </p>
                    ))}
                  </details>
                  <button
                    className="secondary"
                    disabled={blocked}
                    onClick={() => onOpen(d.archived!.journalId)}
                  >
                    이 날짜 보관 일지 열기
                  </button>
                </>
              ) : (
                <p>
                  보관본 없음 — 초안 본문/집계는 확정값으로 포함하지 않습니다.
                </p>
              )}
              {d.pendingDraft && (
                <aside className="notice">
                  <strong>
                    {d.pendingDraft.kind === "pending_correction"
                      ? "더 새로운 정정 초안 대기 — 위 보관본은 이전 버전"
                      : "최초 일지 초안 미보관"}
                  </strong>
                  <p>
                    {d.pendingDraft.id} · v{d.pendingDraft.version}
                  </p>
                  <button
                    className="secondary"
                    disabled={blocked}
                    onClick={() => onOpen(d.pendingDraft!.id)}
                  >
                    미보관 일지 열기
                  </button>
                </aside>
              )}
            </article>
          ))}
          <p className="notice">
            사람/출역/TBM/순찰의 월 합계, 고유 근로자 수/임금/교육 이수를
            계산하지 않습니다. 단건 작업 요약과 참조만 표시하며 세부 안전
            안내/관찰/개선 내용은 원 일지를 확인하세요.
          </p>
        </>
      )}
    </section>
  );
}
