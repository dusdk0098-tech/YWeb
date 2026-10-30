import { useState } from "react";
import { api } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import type { RiskAssessmentRecord } from "../server/risk-core";
export function RiskReuseForm({ siteId, source, onAdopt, onDirtyChange, onBusyChange }: {
  siteId: string; source: RiskAssessmentRecord; onAdopt: (row: RiskAssessmentRecord) => void;
  onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void;
}) {
  const [selected,setSelected]=useState<string[]>([]), [title,setTitle]=useState(""), [date,setDate]=useState(""),
    [timing,setTiming]=useState<"최초"|"정기"|"수시"|"상시">("수시"), [scope,setScope]=useState(""), [trigger,setTrigger]=useState(""),
    [reason,setReason]=useState(""), [plans,setPlans]=useState(false), [confirm,setConfirm]=useState(false),
    [busy,setBusy]=useState(false), [error,setError]=useState("");
  const guard=useDraftGuard(!!(selected.length||timing!=="수시"||title||date||scope||trigger||reason||plans||confirm),busy,onDirtyChange,onBusyChange);
  if (!source.submission || source.status === "draft") return null;
  async function create() {
    const path=`/sites/${siteId}/risk-assessments/${source.id}/reuse`;
    const value={version:source.version,submissionVersion:source.submission!.version,submissionHash:source.submission_hash,
      hazardIds:selected,includePlans:plans,title,date,timing,trigger,workScope:scope,reason,confirmHistoricalCriteria:confirm,confirmReset:confirm};
    setBusy(true);setError("");
    try {const row=await api<RiskAssessmentRecord>(path,"POST",value,guard.key(path,value));onAdopt(row);}
    catch(e){setError((e as Error).message);} finally {setBusy(false);}
  }
  return <section><fieldset disabled={busy}><h3>선택 위험행으로 독립된 새 평가 초안</h3>
    <p>정정/후속 연결을 만들지 않습니다. 과거 설명은 현재 현장에서 다시 확인하세요. 승인·조치 실행·재평가·의견·게시·확인은 복사하지 않습니다.</p>
    <p>원 제출본 {source.id} v{source.submission.version} · 현재 문서 상태 {source.status}</p>
    <p>기준 {source.submission.criteria.body.name} v{source.submission.criteria.version}: 당시 고정 기준입니다. 최신성·현장 적합성 인증이 아닙니다. 다른 기준은 생성 후 명시 교체하세요.</p>
    {source.body.method === "checklist" && <p>일부 항목만 가져오면 미응답 항목을 모두 작성하기 전에는 제출할 수 없습니다.</p>}
    {source.submission.body.hazards.map((h,i)=><label key={h.id}><input type="checkbox" checked={selected.includes(h.id)} disabled={busy}
      onChange={e=>setSelected(e.target.checked?[...selected,h.id]:selected.filter(id=>id!==h.id))}/>{i+1}. {h.task} — {h.scenario}</label>)}
    <label>계획 내용도 복사<input type="checkbox" checked={plans} onChange={e=>setPlans(e.target.checked)}/></label>
    <p>모든 방법의 판단·판단근거를 비웁니다. 계획 담당·예정일·우선순위도 다시 입력합니다. 설명과 현재조치는 과거 텍스트입니다.</p>
    <label>새 제목<input maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <label>새 평가일<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
    <label>평가 시기<select value={timing} onChange={e=>setTiming(e.target.value as typeof timing)}>{["최초","정기","수시","상시"].map(t=><option key={t}>{t}</option>)}</select></label>
    <label>새 작업 범위<textarea maxLength={2000} value={scope} onChange={e=>setScope(e.target.value)}/></label>
    <label>새 시행 계기<textarea maxLength={2000} value={trigger} onChange={e=>setTrigger(e.target.value)}/></label>
    <label>재사용 사유<textarea maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <label><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>당시 기준 사용과 판단/계획 정보 초기화, 현장 재확인 필요를 확인했습니다.</label>
    <button type="button" disabled={busy||!confirm||!selected.length||!title.trim()||!date||!reason.trim()} onClick={()=>void create()}>내 새 초안 생성</button>
    {error&&<p role="alert">{error}</p>}
  </fieldset></section>;
}
