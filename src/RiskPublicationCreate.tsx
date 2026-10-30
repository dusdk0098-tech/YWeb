import { useEffect, useState } from "react";
import { api, type Site } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import type { RiskAssessmentRecord } from "../server/risk-core";
type Recipient = { id: string; name: string; role: string };
export function RiskPublicationCreate({ site, initial, onClose, onPublished, onDirtyChange, onBusyChange }: {
  site: Site; initial: RiskAssessmentRecord; onClose: () => void; onPublished: (id: string) => void;
  onDirtyChange: (v: boolean) => void; onBusyChange: (v: boolean) => void;
}) {
  const [source, setSource] = useState(initial), [selected, setSelected] = useState<Recipient[]>([]),
    [statement, setStatement] = useState(""), [reason, setReason] = useState(""), [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(""),
    [offset, setOffset] = useState(0), [tick, setTick] = useState(0), [page, setPage] = useState<{ items: Recipient[]; hasMore: boolean }>({ items: [], hasMore: false });
  const guard = useDraftGuard(!!statement || !!reason || confirm || selected.length > 0, busy || loading, onDirtyChange, onBusyChange);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setPage({ items: [], hasMore: false });
    api<typeof page>(`/sites/${site.id}/risk-publications/recipients?offset=${offset}`)
      .then((r) => { if (active) setPage(r); }).catch((e: Error) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [site.id, offset, tick]);
  async function reloadSource() {
    setBusy(true); setError("");
    try { setSource(await api<RiskAssessmentRecord>(`/sites/${site.id}/risk-assessments/${source.id}`)); setConfirm(false); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function publish() {
    const path = `/sites/${site.id}/risk-publications`;
    const value = { assessmentId: source.id, assessmentVersion: source.version, submissionHash: source.submission_hash,
      recipientIds: selected.map((r) => r.id), statement, reason, confirmAccountPublication: confirm };
    setBusy(true); setError("");
    try { const result = await api<{ id: string }>(path, "POST", value, guard.key(path, value)); onDirtyChange(false); onPublished(result.id); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section>
    <button disabled={busy || loading} onClick={() => guard.canLeave() && onClose()}>게시 목록으로</button>
    <h2>고정 위험성평가를 현장 계정에 게시</h2>
    <p>이 기능은 계정별 게시/확인 기록입니다. 근로자 본인·참여·숙지·서명·작업 허가를 증명하지 않습니다. 외부 메시지를 보내지 않으며 원 평가의 기존 현장 읽기 권한을 제한하지 않습니다.</p>
    <p>{source.body.title} · 제출 v{source.submission?.version} · {source.submission_hash}</p>
    <button disabled={busy || loading} onClick={reloadSource}>입력 보존·평가 현재 상태 재조회</button>
    {(source.status !== "accepted" || !!source.successor_id) && <p role="alert">후속 문서 없는 수락본에서만 새 게시를 할 수 있습니다.</p>}
    {error && <p role="alert">{error}</p>}
    <fieldset disabled={busy || loading || source.status !== "accepted" || !!source.successor_id || site.role !== "manager"}>
      <legend>현재 현장 대상 계정 {selected.length}/200</legend>
      {page.items.map((person) => <label key={person.id}><input type="checkbox" checked={selected.some((r) => r.id === person.id)} disabled={!selected.some((r) => r.id === person.id) && selected.length >= 200} onChange={(e) => { setSelected(e.target.checked ? [...selected, person] : selected.filter((r) => r.id !== person.id)); setConfirm(false); }} />{person.name} ({person.role})</label>)}
      <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>이전 계정 50개</button>
      <button type="button" disabled={!page.hasMore} onClick={() => setOffset(offset + 50)}>다음 계정 50개</button>
      <button type="button" onClick={() => setTick((n) => n + 1)}>대상 후보 다시 조회</button>
      <ul>{selected.map((person) => <li key={person.id}>{person.name} <button type="button" onClick={() => { setSelected(selected.filter((r) => r.id !== person.id)); setConfirm(false); }}>선택 해제</button></li>)}</ul>
      <label>대상이 확인할 고정 문구<textarea maxLength={2000} value={statement} onChange={(e) => { setStatement(e.target.value); setConfirm(false); }} /></label>
      <label>게시 사유<input maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <label><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />정확한 제출 버전·대상·확인 문구를 검토했습니다. 실제 본인/안전/서명 인증이 아닙니다.</label>
      <p>게시 후 대상과 문구는 바꿀 수 없습니다. 대상 변경은 철회 후 별도 게시하며 이전 확인은 복사하지 않습니다. 새 현장 계정도 자동 추가하지 않습니다.</p>
      <button disabled={!confirm || !statement.trim() || !reason.trim() || !selected.length} onClick={publish}>대상 계정에서 조회 가능한 게시본 만들기</button>
    </fieldset>
  </section>;
}
