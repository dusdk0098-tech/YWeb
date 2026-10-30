import { useEffect, useState } from "react";
import { api } from "./api";
import { WorkPlanPicker } from "./WorkPlanPicker";
import type { RiskAssessmentRecord } from "../server/risk-core";
import type { TbmRiskSourceInput } from "../server/tbm-risk-reference";
export function TbmRiskReferencePicker({siteId,disabled,onSave,onDirtyChange,onBusyChange}: {
  siteId:string; disabled:boolean; onSave:(source:TbmRiskSourceInput|null)=>void;
  onDirtyChange:(v:boolean)=>void; onBusyChange:(v:boolean)=>void;
}) {
  const [candidate,setCandidate]=useState<RiskAssessmentRecord|null>(null),
    [chosen,setChosen]=useState<string[]>([]), [loading,setLoading]=useState(false), [error,setError]=useState("");
  useEffect(()=>{onDirtyChange(!!candidate);return ()=>onDirtyChange(false);},[candidate,onDirtyChange]);
  useEffect(()=>{onBusyChange(loading);return ()=>onBusyChange(false);},[loading,onBusyChange]);
  async function choose(id:string) {
    setLoading(true);setError("");setCandidate(null);setChosen([]);
    try { const row=await api<RiskAssessmentRecord>(`/sites/${siteId}/risk-assessments/${id}`);
      if(row.status!=="accepted" || row.successor_id || !row.submission || !row.submission_hash) throw new Error("후속 없는 수락 평가를 선택하세요.");
      setCandidate(row);
    }catch(e){setError((e as Error).message);}finally{setLoading(false);}
  }
  return <section aria-label="TBM 평가 출처 선택">
    <p>저장된 TBM에 한 개의 평가만 연결합니다. 당일 작업·전달사항은 자동 변경하지 않습니다.</p>
    <WorkPlanPicker path={`/sites/${siteId}/risk-assessments?status=accepted`} label="수락 평가 선택" disabled={disabled||loading} onSelect={(id)=>void choose(id)}/>
    {error&&<p role="alert">{error}</p>}
    {candidate?.submission&&<fieldset disabled={disabled||loading}>
      <legend>{candidate.submission.body.title} · 제출 버전 {candidate.submission.version}</legend>
      <p>SHA-256 {candidate.submission_hash}</p>
      {candidate.submission.body.hazards.map(h=><label key={h.id}><input type="checkbox" checked={chosen.includes(h.id)} onChange={e=>setChosen(e.target.checked?[...chosen,h.id]:chosen.filter(id=>id!==h.id))}/>{h.task} · {h.location} · {h.scenario}</label>)}
      <button disabled={!chosen.length} onClick={()=>onSave({assessmentId:candidate.id,submissionVersion:candidate.submission!.version,submissionHash:candidate.submission_hash!,hazardIds:chosen})}>선택 출처 저장·교체</button>
      <button onClick={()=>{setCandidate(null);setChosen([]);}}>선택 취소</button>
    </fieldset>}
    <button disabled={disabled||loading} onClick={()=>{if(window.confirm("초안의 평가 참조를 해제할까요? 평가 원문은 변경하지 않습니다."))onSave(null);}}>참조 해제</button>
  </section>;
}
