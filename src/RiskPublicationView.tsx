import { useState } from "react";
import { api, type Site } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import type { PublicationAck, PublicationView as View } from "../server/risk-publication-model";
import type { RiskSubmission } from "../server/risk-core";
export function RiskPublicationView({ site, initial, onClose, onDirtyChange, onBusyChange }: {
  site: Site; initial: View; onClose: () => void; onDirtyChange: (v: boolean) => void; onBusyChange: (v: boolean) => void;
}) {
  const [row, setRow] = useState(initial), [confirm, setConfirm] = useState(false), [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false), [error, setError] = useState(""), [source, setSource] = useState<RiskSubmission | null>(null),
    [events, setEvents] = useState<{ version: number; event: string; name: string; at: string; reason: string }[] | null>(null);
  const guard = useDraftGuard(confirm || !!reason, busy, onDirtyChange, onBusyChange);
  const path = `/sites/${site.id}/risk-publications/${row.id}`;
  async function reload() {
    setBusy(true); setError("");
    try { setRow(await api<View>(path)); setConfirm(false); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function showSource() {
    setBusy(true); setError("");
    try {
      const result = await api<{ submission: RiskSubmission; sourceHasSuccessor: boolean; sourceStatus: string }>(path + "/source");
      setSource(result.submission);
      setRow((old) => ({ ...old, sourceHasSuccessor: result.sourceHasSuccessor, sourceStatus: result.sourceStatus, canAcknowledge: old.isTarget && old.status === "published" && result.sourceStatus === "accepted" && !result.sourceHasSuccessor }));
      if (result.sourceHasSuccessor) setConfirm(false);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function loadEvents() {
    setBusy(true); setError("");
    try { const result = await api<{ items: NonNullable<typeof events>; hasMore: boolean }>(path + "/events?offset=0"); setEvents(result.items); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function acknowledge() {
    const endpoint = path + "/acknowledge", value = { version: row.version, publicationHash: row.publicationHash, submissionHash: row.publication.source.submissionHash, confirmOwnAccount: confirm };
    setBusy(true); setError("");
    try {
      const result = await api<{ publicationId: string; ownAck: PublicationAck }>(endpoint, "POST", value, guard.key(endpoint, value));
      setRow((old) => ({ ...old, ownAck: result.ownAck, ...(old.acknowledgements ? { acknowledgements: [...old.acknowledgements.filter((a) => a.user_id !== result.ownAck.user_id), result.ownAck] } : {}) }));
      setConfirm(false);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function withdraw() {
    const endpoint = path + "/withdraw", value = { version: row.version, reason };
    setBusy(true); setError("");
    try {
      const result = await api<{ id: string; status: "withdrawn"; version: number }>(endpoint, "POST", value, guard.key(endpoint, value));
      setRow((old) => ({ ...old, status: result.status, version: result.version, canAcknowledge: false, withdrawReason: reason })); setEvents(null); setReason(""); setConfirm(false);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section>
    <button disabled={busy} onClick={() => guard.canLeave() && onClose()}>게시 목록으로</button>
    <h2>{row.publication.source.title} · 고정 평가 게시본</h2>
    <p>게시 ID {row.id} · 제출 v{row.publication.source.submissionVersion} · {row.publication.source.submissionHash}</p>
    <p>게시자 {row.publication.publisher.name} · 게시 {row.publication.publishedAt}</p>
    <p>상태: {row.status === "published" ? "계정 대상 게시" : "철회됨"}. 게시됨은 외부 발송·도착·열람을 뜻하지 않습니다. 계정 확인은 실제 근로자 본인·참여·숙지·서명·안전 허가를 증명하지 않습니다.</p>
    {row.sourceHasSuccessor && <p role="alert">후속 평가 문서가 있어 이 게시본의 새 확인은 중지됩니다. 이전 확인은 과거 기록으로 남습니다.</p>}
    {row.status === "withdrawn" && <p>철회 사유: {row.withdrawReason} · 시각 {row.withdrawnAt ?? "현재 상태 재조회로 확인"}</p>}
    {error && <p role="alert">{error}</p>}
    <button disabled={busy} onClick={reload}>입력 보존·현재 게시 상태 재조회</button>
    <button disabled={busy} onClick={showSource}>이 게시본의 고정 평가 원문 보기</button>
    {source && <section><h3>게시 당시 고정 제출 원문</h3><p>{source.body.title} · {source.body.date} · {source.body.workScope}</p><p>현재 조치나 이후 재평가를 섞지 않은 원 제출 기록입니다. 펼쳐 보는 동작을 자동 확인/열람 증거로 저장하지 않습니다.</p><details><summary>고정 기준·평가·원 결과 전체 (구조화 원문)</summary><pre className="risk-publication-source">{JSON.stringify(source, null, 2)}</pre></details></section>}
    <h3>고정 확인 문구</h3><p>{row.publication.statement}</p>
    {row.ownAck ? <p>내 계정 확인 기록: {row.ownAck.name} · {row.ownAck.at}. 이 게시본에만 해당하며 새 평가/새 게시본으로 승계되지 않습니다.</p> : row.isTarget ? <fieldset disabled={busy || !row.canAcknowledge}><label><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />표시된 고정 문구와 제출 버전에 대해 내 계정으로 확인 기록을 남깁니다. 타인의 확인을 대신하지 않습니다.</label><button disabled={!confirm} onClick={acknowledge}>내 계정으로 이 게시본 확인</button></fieldset> : <p>내 계정은 대상이 아니므로 대신 확인할 수 없습니다.</p>}
    {site.role === "manager" && row.targets && <section><h3>게시 당시 대상과 계정 확인 기록</h3><ul>{row.targets.map((target) => { const ack = row.acknowledgements?.find((a) => a.user_id === target.userId); return <li key={target.userId}>{target.name} ({target.userId}) · {ack ? `계정 확인 ${ack.at}` : "계정 확인 기록 없음 (실제 미열람 판정 아님)"}</li>; })}</ul></section>}
    {site.role === "manager" && <section><button disabled={busy} onClick={loadEvents}>게시·철회 처리 이력 조회</button>{events && <ul>{events.map((event) => <li key={event.version}>v{event.version} · {event.event === "published" ? "게시" : "철회"} · {event.name} · {event.at} · {event.reason}</li>)}</ul>}</section>}
    {site.role === "manager" && row.status === "published" && <fieldset disabled={busy}><label>새 확인을 중지할 철회 사유<input maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} /></label><button disabled={!reason.trim()} onClick={withdraw}>원문·과거 확인을 보존하고 철회</button></fieldset>}
  </section>;
}
