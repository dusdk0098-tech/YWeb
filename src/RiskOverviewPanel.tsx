import { useEffect, useState } from "react";
import { api, type Site } from "./api";
import type { RiskOverview, RiskOverviewMethod, RiskActionCounts, RiskDocumentCounts } from "../server/risk-overview";
const methodLabels: Record<RiskOverviewMethod, string> = { product: "가능성×중대성 수치형", three_level: "사람 선택 3단계", checklist: "체크리스트 항목별 판단", narrative: "핵심요인 서술형" };
const documentLabels: Record<keyof RiskDocumentCounts, string> = { draft: "초안", submitted: "문서 검토 대기", accepted: "문서 기록 수락", returned: "문서 보완 요청" };
const actionLabels: Record<keyof RiskActionCounts, string> = { assigned: "보고 대기", reported: "다른 관리자 확인 기록 대기", verified: "사람 확인 기록 있음" };
function localDay() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function RiskOverviewSummary({ report }: { report: RiskOverview }) {
  return <>
    <p>현장 전체 기록 집계 · 예정일 비교 기준일 {report.asOfDate} · 조회 {report.generatedAt}</p>
    {report.groups.map((group) => <article key={group.method}>
      <h2>{methodLabels[group.method]}</h2>
      {(["currentLeaf", "priorWithSuccessor"] as const).map((kind) => <section key={kind}>
        <h3>{kind === "currentLeaf" ? "후속 문서가 없는 현재 연결 마지막 문서" : "후속 문서가 있는 이전 문서와 그 조치"}</h3>
        <p>{(Object.keys(documentLabels) as (keyof RiskDocumentCounts)[]).map((status) => `${documentLabels[status]} ${group.documents[kind][status]}건`).join(" · ")}</p>
        {(Object.keys(actionLabels) as (keyof RiskActionCounts)[]).map((status) => {
          const counts = group.actions[kind][status];
          return <p key={status}>{actionLabels[status]}: 기준일 이전 예정 {counts.beforeDate}건 · 당일 예정 {counts.onDate}건 · 이후 예정 {counts.afterDate}건</p>;
        })}
      </section>)}
    </article>)}
    <p>보고 대기·확인 대기의 기준일 이전 예정 건은 현재 기록상 미확인입니다. 실제 미이행·법적 지연으로 판정하지 않습니다. 사람 확인 기록이 있어도 실제 안전·준법·작업 허가를 뜻하지 않습니다.</p>
  </>;
}
export function RiskOverviewPanel({ site }: { site: Site }) {
  const [day, setDay] = useState(localDay), [method, setMethod] = useState<RiskOverviewMethod | "">(""), [tick, setTick] = useState(0);
  const [result, setResult] = useState<{ key: string; report: RiskOverview } | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState<{ key: string; text: string } | null>(null);
  const query = new URLSearchParams({ asOfDate: day, ...(method ? { method } : {}) }).toString();
  const requestKey = `${site.id}?${query}&refresh=${tick}`;
  useEffect(() => {
    let active = true;
    setResult(null); setError(null);
    if (!day) { setLoading(false); return; }
    setLoading(true);
    api<RiskOverview>(`/sites/${site.id}/risk-overview?${query}`)
      .then((report) => { if (active) setResult({ key: requestKey, report }); })
      .catch((e: Error) => { if (active) setError({ key: requestKey, text: e.message }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [site.id, day, query, requestKey]);
  const report = result?.key === requestKey ? result.report : null;
  return <section className="panel">
    <h1>위험성평가 업무 기록 현황</h1>
    <p>{site.name}의 현재 기록 상태입니다. 과거 시점 재현이 아닙니다. 기준일은 현재 조치 예정일 비교에만 적용됩니다.</p>
    <p>후속 초안이 생겨도 이전 문서의 미확인 조치는 별도로 남습니다. 문서·조치 기록 수이며 사람 수나 안전 점수가 아닙니다. 아직 연결하지 않은 계획, 재평가 누락·참조 변경, 본사 통계와 외부 알림은 이 집계에 포함하지 않습니다.</p>
    <label>예정일 비교 기준일<input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
    <label>평가 방법<select value={method} onChange={(e) => setMethod(e.target.value as RiskOverviewMethod | "")}><option value="">모든 방법을 각각 표시</option>{(Object.keys(methodLabels) as RiskOverviewMethod[]).map((value) => <option key={value} value={value}>{methodLabels[value]}</option>)}</select></label>
    <button disabled={loading || !day} onClick={() => setTick((n) => n + 1)}>현황 새로 조회</button>
    {!day && <p>유효한 기준일을 선택하세요. 현재 집계는 표시하지 않습니다.</p>}
    {loading && <p role="status">현재 현장 기록 조회 중…</p>}
    {error?.key === requestKey && <p role="alert">{error.text} 이전 조회 자료는 숨겼습니다.</p>}
    {report && <RiskOverviewSummary report={report} />}
  </section>;
}
