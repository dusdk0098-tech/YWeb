import { useEffect, useRef, useState } from "react";
import { api, uploadLibraryFile, type Site } from "./api";
type LibraryFile = { id: string; title: string; edition: string; filename: string; format: string; size: number; sha256: string; rights_checked_by: string; uploaded_at: string; uploader: string; withdrawn_at: string | null; withdrawn_reason: string | null };
type Library = { revision: number; items: LibraryFile[] };
// WEB-01 1단계: site-members-only library. Managers upload after confirming rights; members download the unscanned original.
export function LibraryPanel({ site }: { site: Site }) {
  const base = `/sites/${site.id}/library`, manager = site.role === "manager";
  const [data, setData] = useState<Library | null>(null), [file, setFile] = useState<File | null>(null), [title, setTitle] = useState(""), [edition, setEdition] = useState(""),
    [rights, setRights] = useState(false), [withdraw, setWithdraw] = useState<{ id: string; reason: string } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [tick, setTick] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    api<Library>(base).then((v) => active && setData(v)).catch((e) => active && setError(e.message));
    return () => { active = false; };
  }, [base, tick]);
  async function run(action: () => Promise<Library>) {
    setBusy(true); setError("");
    try { setData(await action()); return true; } catch (e) { setError((e as Error).message + " 입력은 유지됩니다."); return false; } finally { setBusy(false); }
  }
  return <section className="panel">
    <h1>현장 자료실</h1>
    <p>이 현장 구성원만 보는 자료실입니다. 파일은 검사하지 않은 원본(PDF·PNG·JPEG, 5MB 이하)으로 내려받으며, 삭제하지 않고 게시 중지만 합니다.</p>
    {error && <p role="alert">{error}</p>}
    {manager && data && <fieldset disabled={busy}>
      <legend>자료 올리기 (관리자)</legend>
      <label>자료 제목<input maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>판 표시(예: 2026-10판)<input maxLength={100} value={edition} onChange={(e) => setEdition(e.target.value)} /></label>
      <label>파일<input ref={input} type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      <label><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} />이 자료의 저작권·사용 허락을 확인했습니다</label>
      <button disabled={!file || !title.trim() || !edition.trim() || !rights} onClick={() => void run(() => uploadLibraryFile<Library>(base, file!, data.revision + 1, title, edition, crypto.randomUUID())).then((ok) => {
        if (ok) { setFile(null); setTitle(""); setEdition(""); setRights(false); if (input.current) input.current.value = ""; }
      })}>자료 올리기</button>
    </fieldset>}
    {!data ? !error && <p>조회 중</p> : data.items.length === 0 ? <p>자료가 없습니다.</p> : <ul>
      {data.items.map((f) => <li key={f.id}>
        <strong>{f.title}</strong> · {f.edition} · {f.filename} · {Math.ceil(f.size / 1024)}KB · {f.uploader} {new Date(f.uploaded_at).toLocaleDateString()} · 권리 확인 {f.rights_checked_by}
        {f.withdrawn_at ? <> · <em>게시 중지: {f.withdrawn_reason}</em></> : <> · <a href={`/api${base}/${f.id}/download`}>미검사 원본 내려받기</a></>}
        {manager && !f.withdrawn_at && (withdraw?.id === f.id
          ? <span><label>게시 중지 사유<input maxLength={500} value={withdraw.reason} onChange={(e) => setWithdraw({ id: f.id, reason: e.target.value })} /></label>
            <button disabled={busy || !withdraw.reason.trim()} onClick={() => void run(() => api<Library>(`${base}/${f.id}/withdraw`, "POST", { reason: withdraw.reason }, crypto.randomUUID())).then((ok) => ok && setWithdraw(null))}>게시 중지 확정</button>
            <button disabled={busy} onClick={() => setWithdraw(null)}>취소</button></span>
          : <button disabled={busy} onClick={() => setWithdraw({ id: f.id, reason: "" })}>게시 중지</button>)}
      </li>)}
    </ul>}
    <button disabled={busy} onClick={() => setTick((t) => t + 1)}>목록 새로 보기</button>
  </section>;
}
