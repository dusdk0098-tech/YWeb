import { useEffect, useRef, useState } from "react";
import { api, uploadPhotoBoardDisplay, uploadPhotoBoardPhoto } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import { makePhotoDisplay } from "./photo-display";
import { drawItem, moveCircle, moveItem, resizeCircle, rotateItem, type Scene, type SceneItem } from "./photo-scene";
export type PhotoBoard = {
  id: string; title: string; version: number; updatedAt: string; body: { siteName: string; work: string; footer: string }; scene: Scene;
  photos: { id: string; filename: string; format: string; size: number; width: number | null; height: number | null; hasDisplay: boolean; createdAt: string }[];
};
type Draft = { title: string; body: PhotoBoard["body"]; scene: Scene };
const draftOf = (b: PhotoBoard): Draft => ({ title: b.title, body: b.body, scene: b.scene });
// 사진 보드(N) 1단계 editor: include/order/90° rotation/caption/circle highlight with undo·redo, saved as a scene; PNG uses the same drawing.
export function PhotoBoardEditor({ base, initial, writable, onClose, onDirtyChange, onBusyChange }: {
  base: string; initial: PhotoBoard; writable: boolean; onClose: () => void; onDirtyChange: (v: boolean) => void; onBusyChange: (v: boolean) => void;
}) {
  const [board, setBoard] = useState(initial), [draft, setDraft] = useState<Draft>(draftOf(initial)), [past, setPast] = useState<Draft[]>([]), [future, setFuture] = useState<Draft[]>([]),
    [selected, setSelected] = useState<{ item: number; circle: number | null } | null>(null), [images, setImages] = useState<Record<string, HTMLImageElement>>({}),
    [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const saved = useRef(JSON.stringify(draftOf(initial))), dirty = JSON.stringify(draft) !== saved.current,
    guard = useDraftGuard(dirty, busy, onDirtyChange, onBusyChange), path = `${base}/${board.id}`;
  useEffect(() => {
    for (const p of board.photos) if (p.hasDisplay && !images[p.id]) {
      const img = new Image();
      img.onload = () => setImages((v) => ({ ...v, [p.id]: img }));
      img.src = `/api${path}/photos/${p.id}/display`;
    }
  }, [board.photos, images, path]);
  function change(next: Draft) { setPast((v) => [...v.slice(-49), draft]); setFuture([]); setDraft(next); }
  const setItems = (items: SceneItem[]) => change({ ...draft, scene: { ...draft.scene, items } });
  const setItem = (i: number, item: SceneItem) => setItems(draft.scene.items.map((x, j) => (j === i ? item : x)));
  function undo() { if (!past.length) return; setFuture((v) => [draft, ...v]); setDraft(past[past.length - 1]); setPast((v) => v.slice(0, -1)); }
  function redo() { if (!future.length) return; setPast((v) => [...v, draft]); setDraft(future[0]); setFuture((v) => v.slice(1)); }
  async function upload(files: FileList) {
    setBusy(true); setError(""); setNotice("");
    let current = board, items = draft.scene.items;
    try {
      for (const file of Array.from(files)) {
        const photoPath = `${path}/photos`,
          r = await uploadPhotoBoardPhoto<{ photoId: string; board: PhotoBoard }>(photoPath, file, current.version, guard.key(photoPath, { v: current.version, f: [file.name, file.size, file.lastModified] }));
        current = r.board;
        try {
          const displayPath = `${path}/photos/${r.photoId}/display`;
          current = await uploadPhotoBoardDisplay<PhotoBoard>(displayPath, await makePhotoDisplay(file), current.version, guard.key(displayPath, { id: r.photoId }));
        } catch (e) { setError(`${file.name}: 원본은 저장했습니다. 표시본: ${(e as Error).message}`); }
        items = [...items, { photoId: r.photoId, included: true, rotation: 0, caption: "", circles: [] }];
      }
    } catch (e) { setError((e as Error).message); }
    setBoard(current);
    if (items !== draft.scene.items) change({ ...draft, scene: { ...draft.scene, items } });
    setBusy(false);
  }
  async function save() {
    setBusy(true); setError(""); setNotice("");
    try {
      const body = { version: board.version, ...draft }, next = await api<PhotoBoard>(path, "PUT", body, guard.key(path, body));
      setBoard(next); saved.current = JSON.stringify(draftOf(next)); setDraft(draftOf(next)); setNotice("저장했습니다.");
    } catch (e) { setError((e as Error).message + " 입력은 유지됩니다."); } finally { setBusy(false); }
  }
  function exportPng() {
    const shown = draft.scene.items.filter((i) => i.included && images[i.photoId]);
    if (!shown.length) { setError("포함된 사진이 없어 PNG를 만들 수 없습니다."); return; }
    const W = 1600, cell = 700, head = 220, cols = 2, rows = Math.ceil(shown.length / cols), H = head + rows * (cell + 80) + 120;
    const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#111"; ctx.textBaseline = "top";
    ctx.font = "bold 56px sans-serif"; ctx.fillText(draft.title, 60, 50, W - 120);
    ctx.font = "32px sans-serif"; ctx.fillText([draft.body.siteName, draft.body.work].filter(Boolean).join(" · "), 60, 130, W - 120);
    shown.forEach((item, i) => {
      const x = 60 + (i % cols) * (cell + 80), y = head + Math.floor(i / cols) * (cell + 80);
      drawItem(ctx, images[item.photoId], item, { x, y, w: cell, h: cell });
      ctx.fillStyle = "#111"; ctx.font = "30px sans-serif"; ctx.fillText(item.caption, x, y + cell + 16, cell);
    });
    ctx.font = "28px sans-serif"; ctx.fillText(draft.body.footer, 60, H - 80, W - 120);
    canvas.toBlob((blob) => {
      if (!blob) { setError("PNG를 만들지 못했습니다. 편집 내용은 그대로입니다."); return; }
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${draft.title || "사진 보드"}.png`; a.click(); URL.revokeObjectURL(a.href);
      setNotice(`PNG ${shown.length}장 보드를 만들었습니다.`);
    }, "image/png");
  }
  const placed = new Set(draft.scene.items.map((i) => i.photoId)), unplaced = board.photos.filter((p) => !placed.has(p.id));
  return <section className="panel">
    <button disabled={busy} onClick={() => { if (guard.canLeave()) onClose(); }}>사진 보드 목록으로</button>
    <h2>{draft.title}{dirty ? " · 저장 안 됨" : ""}</h2>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <fieldset disabled={!writable || busy}>
      <label>제목<input maxLength={200} value={draft.title} onChange={(e) => change({ ...draft, title: e.target.value })} /></label>
      <label>현장명<input maxLength={200} value={draft.body.siteName} onChange={(e) => change({ ...draft, body: { ...draft.body, siteName: e.target.value } })} /></label>
      <label>작업내용<input maxLength={500} value={draft.body.work} onChange={(e) => change({ ...draft, body: { ...draft.body, work: e.target.value } })} /></label>
      <label>하단 정보<input maxLength={500} value={draft.body.footer} onChange={(e) => change({ ...draft, body: { ...draft.body, footer: e.target.value } })} /></label>
      <label>사진 추가(PNG·JPEG, 원본 보존)<input type="file" multiple accept=".png,.jpg,.jpeg" onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = ""; }} /></label>
      <button disabled={!past.length} onClick={undo}>실행 취소</button>
      <button disabled={!future.length} onClick={redo}>다시 실행</button>
      <button disabled={!dirty || !draft.title.trim()} onClick={() => void save()}>사진 보드 저장</button>
    </fieldset>
    <button disabled={busy} onClick={exportPng}>PNG 저장</button>
    {unplaced.length > 0 && <p>배치 안 된 사진: {unplaced.map((p) => <button key={p.id} disabled={!writable || busy} onClick={() => setItems([...draft.scene.items, { photoId: p.id, included: true, rotation: 0, caption: "", circles: [] }])}>{p.filename} 배치</button>)}</p>}
    <p>사진을 누르면 그 자리에 원형 강조가 생깁니다. 강조를 고른 뒤 화살표(Shift는 10배)로 옮기고 +/−로 크기를, Delete로 지웁니다.</p>
    <ol>
      {draft.scene.items.map((item, i) => {
        const photo = board.photos.find((p) => p.id === item.photoId);
        return <li key={item.photoId}>
          <ItemCanvas img={images[item.photoId]} item={item} label={`${i + 1}번 사진 ${photo?.filename ?? ""}`} selectedCircle={selected?.item === i ? selected.circle : null}
            onAdd={(x, y) => { if (!writable) return; setItem(i, { ...item, circles: [...item.circles, { x, y, r: 0.08, color: "red" as const }].slice(0, 10) }); setSelected({ item: i, circle: Math.min(item.circles.length, 9) }); }}
            onKey={(e) => {
              const c = selected?.item === i ? selected.circle : null;
              if (!writable || c === null || !item.circles[c]) return;
              const step = e.shiftKey ? 0.1 : 0.01, mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
              if (mv) setItem(i, { ...item, circles: item.circles.map((x, j) => (j === c ? moveCircle(x, mv[0], mv[1]) : x)) });
              else if (e.key === "+" || e.key === "-") setItem(i, { ...item, circles: item.circles.map((x, j) => (j === c ? resizeCircle(x, e.key === "+" ? 0.01 : -0.01) : x)) });
              else if (e.key === "Delete") { setItem(i, { ...item, circles: item.circles.filter((_, j) => j !== c) }); setSelected(null); }
              else return;
              e.preventDefault();
            }} />
          {!photo?.hasDisplay && <p>표시본이 없어 미리보기·PNG에서 빠집니다.</p>}
          <fieldset disabled={!writable || busy}>
            <label><input type="checkbox" checked={item.included} onChange={(e) => setItem(i, { ...item, included: e.target.checked })} />포함</label>
            <button onClick={() => setItems(moveItem(draft.scene.items, i, -1))} disabled={i === 0}>위로</button>
            <button onClick={() => setItems(moveItem(draft.scene.items, i, 1))} disabled={i === draft.scene.items.length - 1}>아래로</button>
            <button onClick={() => setItem(i, rotateItem(item))}>90° 회전</button>
            <label>설명<input maxLength={200} value={item.caption} onChange={(e) => setItem(i, { ...item, caption: e.target.value })} /></label>
            {item.circles.map((c, j) => <button key={j} aria-pressed={selected?.item === i && selected.circle === j} onClick={() => setSelected({ item: i, circle: j })}>강조 {j + 1}</button>)}
            {selected?.item === i && selected.circle !== null && item.circles[selected.circle] && <label>강조 색<select value={item.circles[selected.circle].color} onChange={(e) => setItem(i, { ...item, circles: item.circles.map((x, j) => (j === selected.circle ? { ...x, color: e.target.value as "red" } : x)) })}><option value="red">빨강</option><option value="yellow">노랑</option><option value="blue">파랑</option></select></label>}
            <a href={`/api${path}/photos/${item.photoId}/download`}>미검사 원본 다운로드</a>
          </fieldset>
        </li>;
      })}
    </ol>
  </section>;
}
function ItemCanvas({ img, item, label, selectedCircle, onAdd, onKey }: {
  img?: HTMLImageElement; item: SceneItem; label: string; selectedCircle: number | null; onAdd: (x: number, y: number) => void; onKey: (e: React.KeyboardEvent) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null), rect = useRef({ x: 0, y: 0, w: 0, h: 0 });
  useEffect(() => {
    const canvas = ref.current, ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#f4f4f4"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!img) return;
    rect.current = drawItem(ctx, img, item, { x: 0, y: 0, w: canvas.width, h: canvas.height });
    const c = selectedCircle !== null ? item.circles[selectedCircle] : undefined;
    if (c) { const r = rect.current; ctx.setLineDash([6, 4]); ctx.strokeStyle = "#000"; ctx.lineWidth = 1; ctx.strokeRect(r.x + (c.x - c.r) * r.w, r.y + (c.y - c.r) * r.h, c.r * 2 * r.w, c.r * 2 * r.h); ctx.setLineDash([]); }
  }, [img, item, selectedCircle]);
  return <canvas ref={ref} width={480} height={360} tabIndex={0} role="img" aria-label={`${label} 미리보기, 원형 강조 ${item.circles.length}개`} style={{ maxWidth: "100%", cursor: "crosshair" }}
    onKeyDown={onKey}
    onClick={(e) => {
      const box = e.currentTarget.getBoundingClientRect(), sx = e.currentTarget.width / box.width, sy = e.currentTarget.height / box.height, r = rect.current;
      const x = ((e.clientX - box.left) * sx - r.x) / r.w, y = ((e.clientY - box.top) * sy - r.y) / r.h;
      if (r.w && x >= 0 && x <= 1 && y >= 0 && y <= 1) onAdd(Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000);
    }} />;
}
