import { useState } from "react";
import { api } from "./api";
// MOB-01 1단계: manager registers a worker's date of birth for link participation; only a salted hash is kept.
export function WorkerIdentity({ siteId, workerId, registered, onChange }: { siteId: string; workerId: string; registered: boolean; onChange: (v: boolean) => void }) {
  const [birthDate, setBirthDate] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save(value: string | null) {
    setBusy(true); setError("");
    try {
      const r = await api<{ registered: boolean }>(`/sites/${siteId}/workers/${workerId}/identity`, "PUT", { birthDate: value }, crypto.randomUUID());
      onChange(r.registered); setBirthDate("");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <span>
    <small>참여 본인 확인: {registered ? "생년월일 등록됨" : "미등록"}</small>
    <label>생년월일(해시만 저장)<input type="date" value={birthDate} disabled={busy} onChange={(e) => setBirthDate(e.target.value)} /></label>
    <button type="button" className="secondary" disabled={busy || !birthDate} onClick={() => void save(birthDate)}>등록</button>
    {registered && <button type="button" className="secondary" disabled={busy} onClick={() => void save(null)}>등록 삭제</button>}
    {error && <small role="alert">{error}</small>}
  </span>;
}
