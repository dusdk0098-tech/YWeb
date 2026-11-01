import { useEffect, useState } from "react";
import { api } from "./api";
import {
  BEARING_TABLE, EQUIPMENT_LABEL, GROUND_EQUIPMENT, HITCH, OUTRIGGER_EQUIPMENT, SLING_DEFAULT_SF, SLING_TYPES, WORK_RATIO_DEFAULT,
  calcBody, evaluateCalc, groundDefaults, type CalcBody, type GroundInput,
} from "../server/equipment-calc";
type Saved = { saved: boolean; version: number; formulaVersion: string; updatedAt: string | null; body: CalcBody };
type Sling = CalcBody["slings"][number];
const EFFICIENCY: [string, number][] = [["소켓·스웨이징", 100], ["로크", 90], ["스플라이스", 80], ["클립·웨지", 75]];
function Num({ label, value, onChange, step = "any", disabled }: { label: string; value: number; onChange: (v: number) => void; step?: string; disabled: boolean }) {
  return <label>{label} <input type="number" step={step} min={0} value={Number.isFinite(value) ? value : ""} disabled={disabled} onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} /></label>;
}
// P-02: equipment calculations for one work plan. Owner's decision: provide them, but warn in the app (never on the print)
// that no licensed engineer reviewed the formulas, and flag every coefficient whose source could not be found.
export function WorkPlanCalculations({ path, editable, onDirty }: { path: string; editable: boolean; onDirty: (v: boolean) => void }) {
  const [saved, setSaved] = useState<Saved | null>(null), [body, setBody] = useState<CalcBody | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const dirty = !!saved && JSON.stringify(body) !== JSON.stringify(saved.body);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    let active = true;
    api<Saved>(path).then((v) => { if (active) { setSaved(v); setBody(v.body); } }).catch((e) => active && setError(e.message));
    return () => { active = false; };
  }, [path]);
  if (!body) return <section><h3>장비 계산 (원본 P 계산 양식)</h3>{error ? <p role="alert">{error}</p> : <p>불러오는 중…</p>}</section>;
  const off = !editable || busy, parsed = calcBody.safeParse(body), result = parsed.success ? evaluateCalc(parsed.data) : null;
  const set = (patch: Partial<CalcBody>) => { setNotice(""); setBody({ ...body, ...patch }); };
  const g = body.ground, setG = (patch: Partial<GroundInput>) => set({ ground: { ...g!, ...patch } });
  const setSling = (i: number, patch: Partial<Sling>) => set({ slings: body.slings.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  async function save() {
    setBusy(true); setError("");
    try {
      const v = await api<Saved>(path, "PUT", { version: saved!.version, body }, crypto.randomUUID());
      setSaved(v); setBody(v.body); setNotice("장비 계산을 저장했습니다.");
    } catch (e) { setError((e as Error).message + " 입력은 유지됩니다."); } finally { setBusy(false); }
  }
  return <section className="calc-section">
    <h3>장비 계산 (원본 P 계산 양식)</h3>
    <div className="warning-box" role="note">
      <strong>⚠ 전문가 검토를 받지 않은 계산입니다.</strong> 기술사 등 자격 있는 전문가가 식·계수를 확인하지 않았습니다. 결과를 그대로 믿지 말고 제작사 자료(정격하중표·아웃트리거 반력·슬링 시험성적서)와 현장 지반 조사로 반드시 확인하세요. 원본 엑셀에서 확인된 오류(크롤러 면적 이중 나눗셈, 줄걸이 장력계수 방향)는 고친 식입니다. 이 경고와 아래 근거 경고는 인쇄물에 나오지 않습니다.
    </div>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <fieldset disabled={off}><legend>하중</legend>
      <Num label="화물 중량(t)" value={body.loadT} disabled={off} onChange={(v) => set({ loadT: v })} />
      <Num label="훅·와이어 중량(t)" value={body.hookT} disabled={off} onChange={(v) => set({ hookT: v })} />
      <Num label="기타 달기 중량(t)" value={body.otherT} disabled={off} onChange={(v) => set({ otherT: v })} />
    </fieldset>
    <fieldset disabled={off}><legend>지반 지내력</legend>
      <label>지내력 계산 장비 <select value={g?.equipment ?? ""} onChange={(e) => set({ ground: e.target.value ? { ...groundDefaults(e.target.value as GroundInput["equipment"]), ...(g ? { equipmentWeightT: g.equipmentWeightT, liftLoadT: g.liftLoadT, extraLoadT: g.extraLoadT, allowableKpa: g.allowableKpa, allowableNote: g.allowableNote } : {}) } : null })}>
        <option value="">계산 안 함</option>{GROUND_EQUIPMENT.map((k) => <option key={k} value={k}>{EQUIPMENT_LABEL[k]}</option>)}</select></label>
      {g && <>
        <Num label="장비 중량+웨이트(t)" value={g.equipmentWeightT} disabled={off} onChange={(v) => setG({ equipmentWeightT: v })} />
        <Num label="정격(인양) 하중(t)" value={g.liftLoadT} disabled={off} onChange={(v) => setG({ liftLoadT: v })} />
        <Num label="부가 하중(t)" value={g.extraLoadT} disabled={off} onChange={(v) => setG({ extraLoadT: v })} />
        <Num label="충격하중계수" value={g.impactFactor} disabled={off} onChange={(v) => setG({ impactFactor: v })} />
        {(OUTRIGGER_EQUIPMENT as readonly string[]).includes(g.equipment) && <>
          <Num label="제작사 최대 아웃트리거 반력(kN, 있으면 우선)" value={g.manufacturerReactionKn} disabled={off} onChange={(v) => setG({ manufacturerReactionKn: v })} />
          <Num label="전면 접지계수(기본 0.85)" value={g.frontFactor} disabled={off} onChange={(v) => setG({ frontFactor: v })} />
          <Num label="반력 적용계수(기본 0.5)" value={g.rotationShare} disabled={off} onChange={(v) => setG({ rotationShare: v })} />
          <Num label="회전 증가계수(기본 1.5)" value={g.rotationIncrease} disabled={off} onChange={(v) => setG({ rotationIncrease: v })} />
        </>}
        {g.equipment === "crawler_crane" ? <>
          <Num label="궤도 폭(m)" value={g.trackWidthM} disabled={off} onChange={(v) => setG({ trackWidthM: v })} />
          <Num label="축간 거리(m)" value={g.tumblerDistanceM} disabled={off} onChange={(v) => setG({ tumblerDistanceM: v })} />
          <Num label="궤도 높이(m)" value={g.trackHeightM} disabled={off} onChange={(v) => setG({ trackHeightM: v })} />
          <Num label="높이 계수(원본 0.35)" value={g.heightFactor} disabled={off} onChange={(v) => setG({ heightFactor: v })} />
        </> : <>
          <Num label="받침판 가로(m)" value={g.padLengthM} disabled={off} onChange={(v) => setG({ padLengthM: v })} />
          <Num label="받침판 세로(m)" value={g.padWidthM} disabled={off} onChange={(v) => setG({ padWidthM: v })} />
        </>}
        <Num label="허용지내력(kN/㎡)" value={g.allowableKpa} disabled={off} onChange={(v) => setG({ allowableKpa: v })} />
        <label>허용지내력 근거 <input maxLength={200} value={g.allowableNote} placeholder="평판재하시험 보고서 번호 등" onChange={(e) => setG({ allowableNote: e.target.value })} /></label>
        <label>참고값 불러오기(별표 8, 장기) <select value="" onChange={(e) => { const row = BEARING_TABLE[Number(e.target.value)]; if (row) setG({ allowableKpa: row[1], allowableNote: `별표 8 장기 · ${row[0]}` }); }}>
          <option value="">선택…</option>{BEARING_TABLE.map(([n, v], i) => <option key={n} value={i}>{n} {v}</option>)}</select></label>
        <small> 별표 8 값은 지반조사·재하시험이 없을 때의 대체값입니다(단기는 1.5배).</small>
      </>}
    </fieldset>
    <fieldset disabled={off}><legend>인양 능력</legend>
      <label>인양 장비 <select value={body.lifting?.kind ?? ""} onChange={(e) => { const k = e.target.value as keyof typeof WORK_RATIO_DEFAULT | ""; set({ lifting: k ? { kind: k, ratedCapacityT: body.lifting?.ratedCapacityT ?? 0, workRatioPercent: WORK_RATIO_DEFAULT[k] } : null }); }}>
        <option value="">계산 안 함</option>{(Object.keys(WORK_RATIO_DEFAULT) as (keyof typeof WORK_RATIO_DEFAULT)[]).map((k) => <option key={k} value={k}>{EQUIPMENT_LABEL[k]}</option>)}</select></label>
      {body.lifting && <>
        <Num label="정격하중(t, 작업반경·붐길이 기준 제작사 표 값)" value={body.lifting.ratedCapacityT} disabled={off} onChange={(v) => set({ lifting: { ...body.lifting!, ratedCapacityT: v } })} />
        <Num label="작업하중 비율(%)" value={body.lifting.workRatioPercent} disabled={off} onChange={(v) => set({ lifting: { ...body.lifting!, workRatioPercent: v } })} />
        <small> KOSHA 기준: 트럭크레인 85%, 크롤러 75%, 위험지역 50% 이내.</small>
      </>}
    </fieldset>
    <fieldset disabled={off}><legend>줄걸이</legend>
      {body.slings.map((s, i) => <div key={i}>
        <label>종류 <select value={s.type} onChange={(e) => { const t = e.target.value as Sling["type"]; setSling(i, { type: t, safetyFactor: SLING_DEFAULT_SF[t] }); }}>{Object.entries(SLING_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>걸이 방법 <select value={s.hitch} onChange={(e) => { const h = e.target.value as Sling["hitch"]; setSling(i, { hitch: h, modeFactor: HITCH[h][1] }); }}>{Object.entries(HITCH).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select></label>
        <Num label="파단하중(t, 시험성적서)" value={s.breakingLoadT} disabled={off} onChange={(v) => setSling(i, { breakingLoadT: v })} />
        <Num label="줄 수" step="1" value={s.legs} disabled={off} onChange={(v) => setSling(i, { legs: v, includedAngleDeg: v === 1 ? 0 : s.includedAngleDeg })} />
        <Num label="끼인각(°, 0~120)" value={s.includedAngleDeg} disabled={off} onChange={(v) => setSling(i, { includedAngleDeg: v })} />
        <Num label="모드계수" value={s.modeFactor} disabled={off} onChange={(v) => setSling(i, { modeFactor: v })} />
        <label>단말이음효율(%) <input type="number" min={1} max={100} value={s.efficiencyPercent} onChange={(e) => setSling(i, { efficiencyPercent: Number(e.target.value) })} list="calc-efficiency" /></label>
        <Num label="안전계수" value={s.safetyFactor} disabled={off} onChange={(v) => setSling(i, { safetyFactor: v })} />
        <button type="button" className="secondary" onClick={() => set({ slings: body.slings.filter((_, j) => j !== i) })}>줄걸이 {i + 1} 삭제</button>
      </div>)}
      <datalist id="calc-efficiency">{EFFICIENCY.map(([n, v]) => <option key={n} value={v}>{n}</option>)}</datalist>
      <button type="button" disabled={body.slings.length >= 6} onClick={() => set({ slings: [...body.slings, { type: "wire", breakingLoadT: 0, legs: 2, hitch: "vertical", modeFactor: 1, efficiencyPercent: 100, safetyFactor: 5, includedAngleDeg: 60 }] })}>줄걸이 추가</button>
    </fieldset>
    <fieldset disabled={off}><legend>샤클·달기구</legend>
      {body.shackles.map((s, i) => <div key={i}>
        <Num label="사용하중 WLL(t)" value={s.wllT} disabled={off} onChange={(v) => set({ shackles: body.shackles.map((x, j) => (j === i ? { ...x, wllT: v } : x)) })} />
        <Num label="개수" step="1" value={s.count} disabled={off} onChange={(v) => set({ shackles: body.shackles.map((x, j) => (j === i ? { ...x, count: v } : x)) })} />
        <button type="button" className="secondary" onClick={() => set({ shackles: body.shackles.filter((_, j) => j !== i) })}>달기구 {i + 1} 삭제</button>
      </div>)}
      <button type="button" disabled={body.shackles.length >= 6} onClick={() => set({ shackles: [...body.shackles, { wllT: 0, count: 2 }] })}>달기구 추가</button>
    </fieldset>
    {!parsed.success && <p role="alert">입력 확인: {parsed.error.issues[0].message} ({parsed.error.issues[0].path.join(".")})</p>}
    {result && result.checks.map((c) => <div key={c.title} className="calc-result">
      <h4>{c.title}</h4>
      <table><tbody>{c.lines.map((l) => <tr key={l.label}><th>{l.label}</th><td>{l.formula}</td><td>{l.value} {l.unit}</td></tr>)}</tbody></table>
      <p><strong>판정: {c.verdict}</strong></p>
      {c.warnings.length > 0 && <ul className="warning-list">{c.warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul>}
    </div>)}
    {editable && <button disabled={!dirty || !parsed.success || busy} onClick={() => void save()}>장비 계산 저장</button>}
    {saved?.saved && <a href={`/api${path}/print`} target="_blank" rel="noreferrer">장비 계산서 인쇄 / PDF</a>}
  </section>;
}
