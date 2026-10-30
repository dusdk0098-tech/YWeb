import { CostEvidenceRequest } from "./CostEvidenceRequest";
import { useEffect, useRef, useState } from "react";
import { api, uploadCostEvidence } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import type { Page } from "./attendance-types";
import type { CostExpense } from "./cost-types";
import { costEvidenceWarning, type CostEvidence as Evidence } from "./cost-evidence-types";
import { CostEvidenceWarnings } from "./CostEvidenceWarnings";
type Event = { version: number; event: string; actor_name: string; at: string; reason: string; data: unknown };
export function CostEvidence({ base, onClose, onDirtyChange, onBusyChange }: {
  base: string; onClose: () => void; onDirtyChange: (v: boolean) => void; onBusyChange: (v: boolean) => void;
}) {
  const [view, setView] = useState<Evidence | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true),
    [tick, setTick] = useState(0), [busy, setBusy] = useState(false), [file, setFile] = useState<File | null>(null),
    [editing, setEditing] = useState<string | null>(null), [targets, setTargets] = useState<{expenseId:string;version:number}[]>([]),
    [reason, setReason] = useState(""), [confirm, setConfirm] = useState(false), [offset, setOffset] = useState(0),
    [expenses, setExpenses] = useState<Page<CostExpense> | null>(null), [events, setEvents] = useState<Page<Event> | null>(null),
    [eventOffset, setEventOffset] = useState(0);
  const input = useRef<HTMLInputElement>(null), guard = useDraftGuard(!!file || editing !== null, busy, onDirtyChange, onBusyChange);
  useEffect(() => {
    let active = true; setLoading(true); setConfirm(false); setError(""); setView(null); setEvents(null); setExpenses(null);
    Promise.all([api<Evidence>(base + "/evidence"), api<Page<CostExpense>>(base + `/expenses?offset=${offset}`), api<Page<Event>>(base + `/evidence/events?offset=${eventOffset}`)])
      .then(([v, e, h]) => { if (active) { setView(v); setExpenses(e); setEvents(h); } })
      .catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [base, offset, eventOffset, tick]);
  async function save(upload: boolean) {
    if (!view || busy || (upload ? !file : !editing || !confirm)) return;
    if (upload && !window.confirm("미검사 원본을 보존하며 삭제/용량 회수는 없습니다. 개인정보·권리와 파일을 직접 확인했고 저장할까요?")) return;
    setBusy(true); setError("");
    try {
      let next: Evidence;
      if (upload) {
        const signature = { periodVersion: view.period.version, evidenceVersion: view.evidenceVersion, file: [file!.name, file!.size, file!.lastModified] };
        next = await uploadCostEvidence<Evidence>(base + "/evidence/files", file!, view.period.version, view.evidenceVersion, guard.key(base + "/evidence/files", signature));
        setFile(null); if (input.current) input.current.value = "";
      } else {
        const path = base + `/evidence/files/${editing}/links`, body = { periodVersion: view.period.version, evidenceVersion: view.evidenceVersion, targets, reason, confirmReferencesOnly: true };
        next = await api<Evidence>(path, "POST", body, guard.key(path, body)); setEditing(null); setReason(""); setConfirm(false);
      }
      setView(next); setTick(v => v + 1);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section><button disabled={busy} onClick={() => { if (guard.canLeave()) onClose(); }}>비용 원장으로 돌아가기</button>
    <h2>비용 원본·같은 월 지출 연결</h2><p>{costEvidenceWarning}</p><p>증빙 참조 목록은 정확한 마감 ID/해시에 연결된 별도 기록입니다. 기존 금융 기준본·수기 제출 진술에 파일이나 증빙 목록을 자동 포함하지 않습니다. 과거 마감 목록은 원장의 변경 이력에서 확인하세요.</p>
    <p>월별 보존20파일/각5MiB, 파일별 활성 연결50행. 신고·회의록·작업계획·비용·교육 합산 현장200개/100MiB·전체512MiB. 연결을 분리해도 원본과 용량은 보존됩니다. 다음 월로 복사하지 않습니다.</p>
    {error && <p role="alert">{error} 저장 실패 시 입력은 유지됩니다. 조회 실패를 빈 목록으로 취급하지 않습니다.</p>}
    {loading && <p>조회 중</p>}
    <button disabled={busy || loading} onClick={() => { setConfirm(false); setTick(v => v + 1); }}>입력 유지·최신 조회</button>
    {view && <><p>{view.period.month} · 비용 v{view.period.version} · 증빙 v{view.evidenceVersion} · {view.period.status === "open" ? "작성 중" : "마감됨: 원본·연결 변경 불가"}</p><CostEvidenceWarnings evidence={view}/><CostEvidenceRequest key={`${view.period.siteId}:${view.period.id}`} siteId={view.period.siteId} periodId={view.period.id} />
      {view.period.status === "open" && !editing && <fieldset disabled={busy || loading}><legend>미검사 원본 업로드 (처음 미연결)</legend><input ref={input} type="file" accept=".png,.jpg,.jpeg,.pdf" onChange={e => setFile(e.target.files?.[0] || null)}/><button disabled={!file || view.items.length >= 20} onClick={() => void save(true)}>원본 저장</button></fieldset>}
      {view.items.map(({file:f, links}) => <article key={f.id}><h3>{f.filename}</h3><p>{f.format} · {f.size} bytes · {f.id}</p><p>원본 SHA256 {f.sha256}</p>
        <a href={"/api" + base + `/evidence/files/${f.id}/download`}>미검사 원본 다운로드</a>
        <p>활성 연결 {links.length}개 {links.length === 0 ? "(어느 지출도 입증하지 않는 미연결 원본)" : ""}</p>
        {links.map(l => <p key={l.expenseId}>지출 {l.expenseId} · 연결 당시 {l.source.description} (v{l.source.version}) · 현재 v{l.currentVersion}/{l.currentStatus === "active" ? "유효행" : "취소행"} · {l.changedSinceLink ? "연결 뒤 변경 있음" : "연결 당시와 같은 행"}</p>)}
        {view.period.status === "open" && <button disabled={busy || loading || !!file} onClick={() => { if (guard.canLeave()) { setEditing(f.id); setTargets(links.map(l => ({expenseId:l.expenseId,version:l.currentVersion}))); setReason(""); setConfirm(false); } }}>연결목록 선택·분리·현재 출처 재기록</button>}
      </article>)}
      {editing && view.period.status === "open" && <fieldset disabled={busy || loading}><legend>파일 {editing} · 명시 연결목록 {targets.length}/50</legend>
        <p>선택한 행의 현재 출처를 새로 기록합니다. 기존 선택도 현재 버전으로 재확인하며, 해제한 행은 분리 이력만 남깁니다. 금액/수량은 배분하지 않습니다.</p>
        <p>현재 선택 ID: {targets.map(t => `${t.expenseId} v${t.version}`).join(" · ") || "없음 (모든 연결 분리)"}</p>
        <button onClick={() => { setTargets([]); setConfirm(false); }}>모든 선택 해제</button>
        {expenses?.items.map(e => <label key={e.id}><input type="checkbox" checked={targets.some(t => t.expenseId === e.id)} disabled={!targets.some(t => t.expenseId === e.id) && targets.length >= 50} onChange={ev => { setTargets(old => ev.target.checked ? [...old,{expenseId:e.id,version:e.version}] : old.filter(t => t.expenseId !== e.id)); setConfirm(false); }}/>{e.description} · {e.amount}원 · {e.status === "active" ? "유효행" : "취소행"} · {e.id} v{e.version}</label>)}
        <button disabled={offset === 0} onClick={() => { setConfirm(false); setOffset(v => v - 50); }}>이전 지출50개</button><button disabled={!expenses?.hasMore} onClick={() => { setConfirm(false); setOffset(v => v + 50); }}>다음 지출50개</button>
        <label>연결/분리/재확인 사유<textarea maxLength={1000} value={reason} onChange={e => {setReason(e.target.value);setConfirm(false);}}/></label>
        <label><input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)}/>동일 월의 선택 지출과 버전을 확인했고, 참조 연결일 뿐 적격·배분 판단이 아님을 확인합니다.</label>
        <button disabled={!confirm || !reason.trim()} onClick={() => void save(false)}>명시 연결목록 저장</button>
        <button onClick={() => { if (guard.canLeave()) {setEditing(null);setReason("");setConfirm(false);} }}>취소</button>
      </fieldset>}
    </>}
    {events && <section><h3>증빙 변경 이력</h3>{events.items.map(e => <details key={e.version}><summary>증빙 v{e.version} · {e.event} · {e.actor_name} · {e.at}</summary><p>{e.reason}</p><pre>{JSON.stringify(e.data,null,2)}</pre></details>)}
      <button disabled={busy || loading || eventOffset === 0} onClick={() => setEventOffset(v => v - 20)}>최근 이력20개</button><button disabled={busy || loading || !events.hasMore} onClick={() => setEventOffset(v => v + 20)}>이전 이력20개</button>
    </section>}
  </section>;
}
