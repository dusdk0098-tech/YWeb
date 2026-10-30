import type { DailyCapture } from "../server/daily-journal-sources";
export function DailyJournalSources({
  source,
  siteId,
}: {
  source: DailyCapture | null;
  siteId: string;
}) {
  if (!source)
    return (
      <p className="notice">
        해당일 자료 참조를 아직 가져오지 않았습니다. 자료가0건이어도 작성자가
        명시적으로 가져온 뒤 관리자 보관이 가능합니다.
      </p>
    );
  const a = source.facts.attendance;
  return (
    <section>
      <h3>가져온 해당일 자료 참조 (자동 갱신 아님)</h3>
      <p>
        {source.facts.date} · 취합 {source.capturedAt} ·{" "}
        {source.capturedBy.name} ({source.capturedBy.id})
      </p>
      <p>
        수기 출역 근로자 {a.presentWorkers} · 방문자 {a.presentVisitors} · 취소{" "}
        {a.cancelledRecords} (출역 집계 제외)
      </p>
      <p className="muted">
        참조 fingerprint {source.fingerprint} · 출역 revision hash{" "}
        {a.revisionHash}
      </p>
      <p>
        TBM 확정 버전 {source.facts.tbm.length}개 — 정정 버전도 포함하므로 실제
        개최 횟수가 아닙니다.
      </p>
      {source.facts.tbm.map((t) => (
        <article key={t.id}>
          <p>
            {t.title} · {t.id}
          </p>
          <p className="muted">
            SHA-256 {t.hash} · 이전 {t.parentId || "없음"}
          </p>
          <p>
            가져올 당시 후속:{" "}
            {t.successor
              ? `${t.successor.id} · ${t.successor.status} · ${t.successor.date}`
              : "없음"}
          </p>
          <a
            className="button secondary"
            href={`/api/sites/${siteId}/tbm/${t.id}/print`}
            target="_blank"
            rel="noreferrer"
          >
            참조 TBM 인쇄 보기
          </a>
        </article>
      ))}
      <p className="notice">
        출역 ≠ TBM 참여 ≠ 서명 ≠ 교육 이수. 취합은 사실 입력을 인증하지
        않습니다. 보관 이후 원자료가 바뀌어도 이 참조는 유지됩니다.
      </p>
    </section>
  );
}
