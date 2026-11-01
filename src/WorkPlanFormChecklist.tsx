import { useEffect, useState } from "react";
import { api } from "./api";
import { FORM_MODULES, formChoiceProblem, type FormChoice } from "../server/work-plan-form-catalog";
type Checklist = { saved: boolean; version: number; policyVersion: string; updatedAt: string | null; choices: FormChoice[] };
const LEVEL = { REQUIRED: "필수", RECOMMENDED: "권장", OPTIONAL: "선택" } as const;
// P-01 1단계: 원본 P 양식사용 체크리스트 — which of the 17 original forms this plan uses. Author-only, draft-only.
export function WorkPlanFormChecklist({ path, editable, onDirty }: { path: string; editable: boolean; onDirty: (v: boolean) => void }) {
  const [saved, setSaved] = useState<Checklist | null>(null), [choices, setChoices] = useState<FormChoice[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const dirty = !!saved && JSON.stringify(choices) !== JSON.stringify(saved.choices), problem = saved ? formChoiceProblem(choices) : null;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    let active = true;
    api<Checklist>(path).then((v) => { if (active) { setSaved(v); setChoices(v.choices); } }).catch((e) => active && setError(e.message));
    return () => { active = false; };
  }, [path]);
  const set = (i: number, patch: Partial<FormChoice>) => { setNotice(""); setChoices((v) => v.map((c, j) => (j === i ? { ...c, ...patch } : c))); };
  async function save() {
    setBusy(true); setError("");
    try {
      const v = await api<Checklist>(path, "PUT", { version: saved!.version, choices }, crypto.randomUUID());
      setSaved(v); setChoices(v.choices); setNotice("양식 체크리스트를 저장했습니다.");
    } catch (e) { setError((e as Error).message + " 입력은 유지됩니다."); } finally { setBusy(false); }
  }
  return <section>
    <h3>양식사용 체크리스트 (원본 P 시트 1)</h3>
    <p className="muted">원본 P 앱의 17개 양식 중 이 작업계획에 쓸 양식을 고릅니다. 필수 양식은 제외할 수 없습니다. 법적 필수 서류 판정이 아니며, 계산 양식은 아래 장비 계산에서 입력합니다.{saved && !saved.saved ? " 아직 저장 전(기본값)입니다." : ""}</p>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {saved && <table>
      <thead><tr><th>원본</th><th>양식</th><th>구분</th><th>포함</th><th>메모</th><th>이 앱</th></tr></thead>
      <tbody>{FORM_MODULES.map((m, i) => {
        const c = choices[i];
        return <tr key={m.type}>
          <td>{m.sheet}</td><th>{m.title}</th><td>{LEVEL[m.requirement]}</td>
          <td><input type="checkbox" aria-label={`${m.title} 포함`} checked={c.included} disabled={!editable || busy || m.requirement === "REQUIRED"} onChange={(e) => set(i, { included: e.target.checked })} /></td>
          <td><input aria-label={`${m.title} 메모`} maxLength={500} value={c.note} disabled={!editable || busy} onChange={(e) => set(i, { note: e.target.value })} /></td>
          <td>{m.app}</td>
        </tr>;
      })}</tbody>
    </table>}
    {problem && <p role="alert">{problem}</p>}
    {editable && <button disabled={!dirty || !!problem || busy} onClick={() => void save()}>양식 체크리스트 저장</button>}
    <a href={`/api${path}/print`} target="_blank" rel="noreferrer">양식 체크리스트 인쇄 / PDF</a>
  </section>;
}
