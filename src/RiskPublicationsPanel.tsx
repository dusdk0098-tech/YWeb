import { useEffect, useState } from "react";
import { api, type Site } from "./api";
import { WorkPlanPicker } from "./WorkPlanPicker";
import { RiskPublicationCreate } from "./RiskPublicationCreate";
import { RiskPublicationView } from "./RiskPublicationView";
import type { PublicationView } from "../server/risk-publication-model";
import type { RiskAssessmentRecord } from "../server/risk-core";
export function RiskPublicationsPanel({ site, onClose, onDirtyChange, onBusyChange }: {
  site: Site; onClose: () => void; onDirtyChange: (v: boolean) => void; onBusyChange: (v: boolean) => void;
}) {
  const [page, setPage] = useState<{ items: PublicationView[]; hasMore: boolean }>({ items: [], hasMore: false }),
    [offset, setOffset] = useState(0), [tick, setTick] = useState(0), [loading, setLoading] = useState(false), [error, setError] = useState(""),
    [create, setCreate] = useState<RiskAssessmentRecord | null>(null), [selected, setSelected] = useState<string | null>(null), [opened, setOpened] = useState<PublicationView | null>(null);
  const base = `/sites/${site.id}/risk-publications`;
  useEffect(() => {
    if (create) return;
    let active = true;
    setLoading(true); setError(""); setOpened(null); setPage({ items: [], hasMore: false });
    const work = selected
      ? api<PublicationView>(base + "/" + selected).then((r) => { if (active) setOpened(r); })
      : api<typeof page>(base + `?offset=${offset}`).then((r) => { if (active) setPage(r); });
    work.catch((e: Error) => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [base, offset, tick, selected, create]);
  useEffect(() => { onBusyChange(loading); return () => onBusyChange(false); }, [loading, onBusyChange]);
  function back() { setCreate(null); setSelected(null); setOpened(null); onDirtyChange(false); setTick((n) => n + 1); }
  async function selectSource(id: string) {
    setLoading(true); setError("");
    try { setCreate(await api<RiskAssessmentRecord>(`/sites/${site.id}/risk-assessments/${id}`)); }
    catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }
  if (create) return <RiskPublicationCreate site={site} initial={create} onClose={back} onPublished={(id) => { setCreate(null); setSelected(id); setOpened(null); onDirtyChange(false); }} onDirtyChange={onDirtyChange} onBusyChange={onBusyChange} />;
  if (opened) return <RiskPublicationView site={site} initial={opened} onClose={back} onDirtyChange={onDirtyChange} onBusyChange={onBusyChange} />;
  return <section>
    <button disabled={loading} onClick={() => { onDirtyChange(false); onClose(); }}>위험성평가 목록으로</button>
    <h1>{site.role === "manager" ? "현장 위험성평가 게시본" : "내 계정 대상 위험성평가 게시본"}</h1>
    <p>게시와 계정 확인만 기록합니다. 근로자 신원·서명·참여·숙지·안전 또는 작업 허가를 증명하지 않으며 외부 발송/열람 추적을 하지 않습니다. 원 평가의 기존 현장 읽기 권한은 바뀌지 않습니다.</p>
    {error && <p role="alert">{error} 게시 생성 후 상세 조회만 실패했다면 재게시하지 말고 현재 게시본을 다시 조회하세요.</p>}
    {selected && <button disabled={loading} onClick={back}>게시 목록 다시 열기</button>}
    <button disabled={loading} onClick={() => setTick((n) => n + 1)}>현재 목록/게시본 다시 조회</button>
    {site.role === "manager" && !selected && <WorkPlanPicker path={`/sites/${site.id}/risk-assessments?status=accepted`} label="게시할 수락 평가 선택 (후속 문서 없는 평가만 게시 가능)" disabled={loading} onSelect={selectSource} />}
    <ul>{page.items.map((p) => <li key={p.id}><button disabled={loading} onClick={() => setSelected(p.id)}>{p.publication.source.title} / 제출 v{p.publication.source.submissionVersion} / {p.status === "withdrawn" ? "철회" : p.sourceHasSuccessor ? "후속 문서 있음·새 확인 중지" : "게시"} / {p.ownAck ? "내 확인 있음" : "내 확인 없음"}</button></li>)}</ul>
    {!selected && <><button disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>이전 50</button><button disabled={loading || !page.hasMore} onClick={() => setOffset(offset + 50)}>다음 50</button></>}
    {loading && <p role="status">현재 권한으로 게시본 조회 중…</p>}
  </section>;
}
