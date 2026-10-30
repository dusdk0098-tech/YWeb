import { useState } from "react";
import { api } from "./api";
import type { EvidenceComparison, EvidenceComparisonSelector } from "../server/cost-evidence-comparison";
export function CostEvidenceComparison({ base, selection, disabled = false }: { base: string; selection: EvidenceComparisonSelector; disabled?: boolean }) {
  const [fingerprint, setFingerprint] = useState(""), [result, setResult] = useState<EvidenceComparison | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const query = new URLSearchParams(selection).toString(), endpoint = `${base}/evidence-comparison`;
  async function run(prepare: boolean) {
    setBusy(true); setError(""); setResult(null);
    const expected = fingerprint; setFingerprint("");
    try {
      const value = await api<EvidenceComparison>(`${endpoint}/${prepare ? "prepare" : "compare"}?${query}${prepare ? "" : `&expectedFingerprint=${expected}`}`);
      if (value.state === "ready") { setFingerprint(value.fingerprint); if (!prepare) setResult(value); }
      else setResult(value);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section><h4>고정 증빙과 같은 월 현재 참조 비교</h4>
    <p>저장 메타데이터·연결만 비교합니다. 원본 바이트 재검사·악성코드 검사·증빙 적격 판정·금액 배분이 아닙니다. 과거 미기록은 빈 목록과 다릅니다.</p>
    <button disabled={disabled || busy} onClick={() => void run(true)}>현재 자료로 비교 준비</button>
    <button disabled={disabled || busy || !fingerprint} onClick={() => void run(false)}>준비한 자료 비교</button>
    {error && <p role="alert">{error}</p>}
    {fingerprint && !result && <p>준비됨. 비교 버튼으로 변경 여부를 재확인하세요.</p>}
    {result && (result.state !== "ready" ? <p role="alert">{result.reason}</p> : <>
      <p>고정 마감 {result.source.closureId} · 당시 증빙 v{result.source.evidenceVersion} / 현재 v{result.current.evidenceVersion} · 조회 {result.queriedAt}</p>
      <p>{result.current.evidenceHistoryChanged ? "증빙 이력 버전이 다릅니다." : "증빙 이력 버전이 같습니다."} 참조 차이 0개도 원본의 안전·적격·동일 바이트 인증이 아닙니다.</p>
      <p>원본 추가 {result.changes.addedOriginals.length} · 연결 추가 {result.changes.addedReferences.length} · 연결 제거 {result.changes.removedReferences.length} · 유지 연결 출처 변경 {result.changes.changedReferences.length}</p>
      <p>sourceReselected는 연결 당시 출처 재선택, currentExpenseChanged는 마감 당시 대비 현재 지출 변경입니다. 연결 제거는 파일 삭제가 아닙니다.</p>
      <pre>{JSON.stringify(result.changes, null, 2)}</pre>
      <a href={`/api${endpoint}/export.json?${query}&expectedFingerprint=${fingerprint}`}>이 비교 JSON</a>{" "}<a target="_blank" rel="noreferrer" href={`/api${endpoint}/print?${query}&expectedFingerprint=${fingerprint}`}>이 비교 HTML</a>
    </>)}
  </section>;
}
