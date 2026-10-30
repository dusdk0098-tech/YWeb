import type { TbmRiskReference } from "../server/tbm-risk-reference";
export function TbmRiskReferenceView({ reference, sourceHasSuccessor, historicalAtFinalization }: {
  reference: TbmRiskReference | null;
  sourceHasSuccessor?: boolean;
  historicalAtFinalization?: boolean;
}) {
  if (!reference) return <p>연결된 위험성평가 없음. 과거 출처를 추정하지 않습니다.</p>;
  return <section aria-label="고정 위험성평가 출처">
    <h3>고정 위험성평가 출처</h3>
    <p>{reference.title} · {reference.date} · 방법 {reference.method}</p>
    <p>평가 ID {reference.assessmentId} · 제출 버전 {reference.submissionVersion}</p>
    <p>제출 SHA-256: {reference.submissionHash}</p>
    {sourceHasSuccessor && <p role="status">현재 조회: 후속 평가가 있습니다. 이 TBM은 당시 고정본을 참조합니다.</p>}
    {historicalAtFinalization && <p>확정 당시 후속 평가가 있는 고정 출처 사용을 관리자가 확인했습니다.</p>}
    <p>선택 위험행의 설명 요약입니다. 전체 평가·방법별 판단을 대신하지 않으며 실제 전달·참여·서명·이해·안전 허가를 증명하지 않습니다.</p>
    {reference.hazards.map((h) => <article key={h.id}>
      <h4>{h.task} · {h.location}</h4><p>위험행 ID {h.id}</p>
      <p>위험 상황: {h.scenario}</p><p>예상 피해: {h.harm}</p>
      <p>평가 제출 당시 현재 조치: {h.currentControls}</p>
    </article>)}
  </section>;
}
