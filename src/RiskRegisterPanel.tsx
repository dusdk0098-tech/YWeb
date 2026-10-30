import { useEffect,useState } from "react";
import { api,type Site,type User } from "./api";
import type { RiskAssessmentRecord } from "../server/risk-core";
import { RiskAssessmentEditor } from "./RiskAssessmentEditor";
import { RiskRegister } from "./RiskRegister";
export function RiskRegisterPanel({site,user,onClose,onDirtyChange,onBusyChange}:{site:Site;user:User;onClose:()=>void;onDirtyChange:(v:boolean)=>void;onBusyChange:(v:boolean)=>void}){
 const [selectedId,setSelectedId]=useState<string|null>(null),[detail,setDetail]=useState<{key:string;row:RiskAssessmentRecord}|null>(null),[error,setError]=useState<{key:string;text:string}|null>(null),[listBusy,setListBusy]=useState(false);
 const key=`${site.id}:${selectedId??""}`;
 useEffect(()=>{if(!selectedId)return;let active=true;setError(null);onBusyChange(true);
  api<RiskAssessmentRecord>(`/sites/${site.id}/risk-assessments/${selectedId}`).then(row=>{if(active)setDetail({key,row});}).catch((e:Error)=>{if(active)setError({key,text:e.message});}).finally(()=>{if(active)onBusyChange(false);});
  return()=>{active=false;onBusyChange(false);};
 },[site.id,selectedId,key,onBusyChange]);
 useEffect(()=>{if(!selectedId)onBusyChange(listBusy);return()=>{if(!selectedId)onBusyChange(false);};},[listBusy,selectedId,onBusyChange]);
 if(selectedId&&detail?.key===key)return <RiskAssessmentEditor key={key} site={site} user={user} method={detail.row.body.method} initial={detail.row} onClose={()=>{setSelectedId(null);setDetail(null);onDirtyChange(false);}} onDirtyChange={onDirtyChange} onBusyChange={onBusyChange}/>;
 if(selectedId)return <section><p>현재 현장 권한으로 선택 문서 조회 중…</p>{error?.key===key&&<p role="alert">{error.text}</p>}<button onClick={()=>{setSelectedId(null);setDetail(null);}}>검색 첫 화면으로</button></section>;
 return <section><button disabled={listBusy} onClick={onClose}>위험성평가 목록으로</button><p>{site.name} · 기존 목록/작성 방법 선택과 별개인 전체 문서 검색입니다. 상세에서 돌아오면 검색 첫 화면을 새로 조회합니다.</p><RiskRegister site={site} onOpen={setSelectedId} onBusyChange={setListBusy}/></section>;
}
