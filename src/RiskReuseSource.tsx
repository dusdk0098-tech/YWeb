import { useEffect, useState } from "react";
import { api } from "./api";
import type { RiskReuseProvenance } from "../server/risk-reuse";
export function RiskReuseSource({siteId,id,onOpen}:{siteId:string;id:string;onOpen:(id:string)=>void}) {
  const [result,setResult]=useState<{key:string;source:RiskReuseProvenance|null;error:string}|null>(null), key=`${siteId}:${id}`;
  useEffect(()=>{let current=true;api<{source:RiskReuseProvenance|null}>(`/sites/${siteId}/risk-assessments/${id}/reuse-source`).then(r=>{if(current)setResult({key,source:r.source,error:""});}).catch(e=>{if(current)setResult({key,source:null,error:(e as Error).message});});return()=>{current=false;};},[siteId,id,key]);
  if(result?.key!==key)return <p>재사용 출처 조회 중…</p>;
  if(result.error)return <p role="alert">출처 조회 실패: {result.error}</p>;
  if(!result.source)return null;
  const s=result.source;
  return <section><h3>독립 재사용 출처 (정정 관계 아님)</h3>
    <button type="button" onClick={()=>onOpen(s.sourceId)}>원 제출 문서 조회</button>
    <p>{s.sourceId} / 제출 v{s.sourceSubmissionVersion} / hash {s.sourceSubmissionHash}</p>
    <p>당시 기준 {s.criteriaId} v{s.criteriaVersion} / hash {s.criteriaHash}</p>
    <p>재사용 계정 {s.actor.name} / {s.at} / 사유 {s.reason}</p>
    <p>계획 내용 {s.includePlans?"포함":"제외"}. 생성 당시 판단과 계획 담당·예정일·우선순위를 초기화했습니다. 승인·조치·재평가·의견·게시·확인을 상속하지 않았습니다. 현재 편집 내용과 당시 출처는 별개입니다.</p>
    <details><summary>원 위험행 → 생성 위험행</summary>{s.mapping.map(m=><p key={m.newHazardId}>{m.sourceHazardId} → {m.newHazardId}</p>)}</details>
  </section>;
}
