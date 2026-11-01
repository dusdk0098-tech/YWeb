import { useEffect, useState } from "react";
import { api, type Site } from "./api";
import { PhotoBoardEditor, type PhotoBoard } from "./PhotoBoardEditor";
import { EmptyState, Notice, PageHeader } from "./ui";
// 사진 보드(N) 1단계: list, create, open. Photos are shown only as browser-made EXIF-free display copies.
export function PhotoBoardPanel({ site, onDirtyChange, onBusyChange }: { site: Site; onDirtyChange: (v: boolean) => void; onBusyChange: (v: boolean) => void }) {
  const [page, setPage] = useState<{ items: { id: string; title: string; version: number; updated_at: string }[]; hasMore: boolean } | null>(null),
    [offset, setOffset] = useState(0), [tick, setTick] = useState(0), [open, setOpen] = useState<PhotoBoard | null>(null),
    [title, setTitle] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const base = `/sites/${site.id}/photo-boards`, writer = site.role !== "viewer";
  useEffect(() => {
    if (open) return;
    let active = true;
    setPage(null);
    api<NonNullable<typeof page>>(`${base}?offset=${offset}`).then((v) => active && setPage(v)).catch((e) => active && setError(e.message));
    return () => { active = false; };
  }, [base, offset, tick, open]);
  async function run(action: () => Promise<PhotoBoard>) {
    setBusy(true); setError("");
    try { setOpen(await action()); setTitle(""); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (open) return <PhotoBoardEditor key={open.id} base={base} initial={open} writable={writer} onClose={() => { setOpen(null); setTick((t) => t + 1); }} onDirtyChange={onDirtyChange} onBusyChange={onBusyChange} />;
  return <section className="panel">
    <PageHeader level={1} title="사진 보드" />
    <Notice summary="화면과 출력에는 위치·기기 정보를 지운 표시본만 씁니다. 원본은 그대로 보관합니다.">작업 전후 사진을 골라 순서·방향·설명·강조 표시를 정하고 PNG로 저장합니다. 원본 사진은 보존하고 내려받기만 하며, 화면과 출력에는 이 브라우저가 만든 표시본(위치·기기 정보 제거)만 씁니다.</Notice>
    {error && <p role="alert">{error}</p>}
    {writer && <fieldset disabled={busy} className="inline-create">
      <legend>새 사진 보드</legend>
      <label>제목<input maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <button disabled={!title.trim()} onClick={() => void run(() => api<PhotoBoard>(base, "POST", { title }, crypto.randomUUID()))}>사진 보드 만들기</button>
    </fieldset>}
    {!page ? !error && <p>조회 중</p> : page.items.length ? page.items.map((b) => <article key={b.id} className="record-row">
      <div className="record-row-main"><h2>{b.title}</h2><p>최근 저장 {b.updated_at.slice(0, 16).replace("T", " ")}</p></div>
      <button className="secondary" disabled={busy} aria-label={`${b.title} 열기`} onClick={() => void run(() => api<PhotoBoard>(`${base}/${b.id}`))}>열기</button>
    </article>) : <EmptyState title="사진 보드가 없습니다.">제목을 넣고 사진 보드를 만드세요.</EmptyState>}
    <div className="actions">
      <button className="secondary" disabled={busy || !offset} onClick={() => setOffset((v) => v - 50)}>이전 50</button>
      <button className="secondary" disabled={busy || !page?.hasMore} onClick={() => setOffset((v) => v + 50)}>다음 50</button>
    </div>
  </section>;
}
