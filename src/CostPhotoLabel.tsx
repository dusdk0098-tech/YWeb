import { useEffect, useState } from "react";
import { api } from "./api";
import { photoGroups } from "../server/cost-photo-schema";
export type PhotoLabel = { attachmentId: string; filename: string; groupName: string; takenDate: string; description: string; included: boolean; labelVersion: number };
// SC 사진대지 항목: same fields as the original photo form (분류·촬영일·내용), plus 포함 instead of delete (originals are retained).
export function CostPhotoLabel({ base, photo, open, disabled, onSaved, onDirty, keyFor }: {
  base: string; photo: PhotoLabel; open: boolean; disabled: boolean; onSaved: () => void; onDirty: (id: string, v: boolean) => void; keyFor: (path: string, body: unknown) => string;
}) {
  const [form, setForm] = useState(photo), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const dirty = form.groupName !== photo.groupName || form.takenDate !== photo.takenDate || form.description !== photo.description || form.included !== photo.included;
  useEffect(() => { onDirty(photo.attachmentId, dirty); }, [photo.attachmentId, dirty, onDirty]);
  async function save() {
    setBusy(true); setError("");
    const path = base + `/evidence/files/${photo.attachmentId}/display/label`,
      body = { labelVersion: photo.labelVersion, groupName: form.groupName, takenDate: form.takenDate, description: form.description, included: form.included };
    try { await api(path, "PUT", body, keyFor(path, body)); onDirty(photo.attachmentId, false); onSaved(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <fieldset disabled={!open || disabled || busy}><legend>사진대지 항목</legend>
    {error && <p role="alert">{error} 입력은 유지됩니다.</p>}
    <label>분류<select value={form.groupName} onChange={e => setForm(v => ({ ...v, groupName: e.target.value }))}>{photoGroups.map(g => <option key={g}>{g}</option>)}</select></label>
    <label>촬영일<input type="date" value={form.takenDate} onChange={e => setForm(v => ({ ...v, takenDate: e.target.value }))}/></label>
    <label>내용<input maxLength={200} value={form.description} onChange={e => setForm(v => ({ ...v, description: e.target.value }))}/></label>
    <label><input type="checkbox" checked={form.included} onChange={e => setForm(v => ({ ...v, included: e.target.checked }))}/>사진대지에 포함</label>
    <button disabled={!dirty} onClick={() => void save()}>사진대지 항목 저장</button>
  </fieldset>;
}
