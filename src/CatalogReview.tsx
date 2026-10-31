import { useEffect, useState } from "react";
import { api } from "./api";
export type CatalogReviewRecord = { id: number; target: string; source: string; rightsCheckedBy: string; rightsCheckedDate: string; currencyCheckedDate: string; note: string; actorName: string; at: string };
const empty = { target: "", source: "", rightsCheckedBy: "", rightsCheckedDate: "", currencyCheckedDate: "", note: "" };
// 교육 B안: append-only review records of a published content version. Managers add; everyone sees the latest.
export function CatalogReview({ path, sourceHash, manager, keyFor, onLatest, onDirty }: {
  path: string; sourceHash: string; manager: boolean; keyFor: (path: string, body: unknown) => string;
  onLatest: (v: CatalogReviewRecord | null) => void; onDirty: (v: boolean) => void;
}) {
  const [items, setItems] = useState<CatalogReviewRecord[] | null>(null), [form, setForm] = useState(empty), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const dirty = Object.values(form).some(Boolean);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    let active = true;
    api<{ items: CatalogReviewRecord[] }>(path).then((v) => { if (active) { setItems(v.items); onLatest(v.items[0] ?? null); } }).catch((e) => active && setError(e.message));
    return () => { active = false; };
  }, [path, onLatest]);
  async function save() {
    setBusy(true); setError("");
    const body = { sourceHash, ...form };
    try {
      const v = await api<{ items: CatalogReviewRecord[] }>(path, "POST", body, keyFor(path, body));
      setItems(v.items); onLatest(v.items[0] ?? null); setForm(empty);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const latest = items?.[0];
  return <section>
    <h3>교육내용 검수 기록</h3>
    <p>기록한 사람이 확인했다고 남긴 내용입니다. 법정 적용대상·필수시간 판정이 아닙니다.</p>
    {error && <p role="alert">{error} 입력은 유지됩니다.</p>}
    {!items ? !error && <p>조회 중</p> : latest
      ? <p>최근 검수: 적용대상 {latest.target} · 출처 {latest.source} · 권리 확인 {latest.rightsCheckedBy}({latest.rightsCheckedDate}) · 현행성 확인 {latest.currencyCheckedDate}{latest.note ? ` · ${latest.note}` : ""} — {latest.actorName} 기록 {latest.at}</p>
      : <p>검수 기록 없음</p>}
    {items && items.length > 1 && <details><summary>이전 검수 기록 {items.length - 1}건</summary><ul>{items.slice(1).map((r) => <li key={r.id}>{r.at} {r.actorName}: 적용대상 {r.target} · 출처 {r.source} · 권리 {r.rightsCheckedBy}({r.rightsCheckedDate}) · 현행성 {r.currencyCheckedDate}</li>)}</ul></details>}
    {manager && <fieldset disabled={busy}>
      <legend>새 검수 기록 남기기 (수정·삭제 없음)</legend>
      {([["target", "적용대상", "text"], ["source", "출처", "text"], ["rightsCheckedBy", "권리 확인자", "text"], ["rightsCheckedDate", "권리 확인일", "date"], ["currencyCheckedDate", "현행성 확인일", "date"], ["note", "메모", "text"]] as const).map(([k, label, type]) => (
        <label key={k}>{label}<input type={type} maxLength={k === "note" ? 1000 : 500} value={form[k]} onChange={(e) => setForm((v) => ({ ...v, [k]: e.target.value }))} /></label>
      ))}
      <button disabled={!form.target.trim() || !form.source.trim() || !form.rightsCheckedBy.trim() || !form.rightsCheckedDate || !form.currencyCheckedDate} onClick={() => void save()}>검수 기록 저장</button>
    </fieldset>}
  </section>;
}
