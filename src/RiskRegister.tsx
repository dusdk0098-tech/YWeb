import { useEffect,useState } from "react";
import { api,type Site } from "./api";
import type { RiskRegisterPage } from "../server/risk-register";
const methods={product:"가능성×중대성",three_level:"사람 선택3단계",checklist:"체크리스트",narrative:"핵심요인 서술형"};
const statuses={draft:"초안",submitted:"문서 검토 대기",accepted:"문서 기록 수락",returned:"문서 보완 요청"};
const blank={dateFrom:"",dateTo:"",method:"",status:"",lineage:"all",keyword:""};
export function RiskRegister({site,onOpen,onBusyChange}:{site:Site;onOpen:(id:string)=>void;onBusyChange?:(v:boolean)=>void}){
 const [draft,setDraft]=useState(blank),[applied,setApplied]=useState(blank),[offset,setOffset]=useState(0),[tick,setTick]=useState(0),
  [result,setResult]=useState<{key:string;page:RiskRegisterPage}|null>(null),[error,setError]=useState<{key:string;text:string}|null>(null),[busy,setBusy]=useState(false);
 const query=new URLSearchParams({offset:String(offset),...Object.fromEntries(Object.entries(applied).filter(([,v])=>v!==""))}).toString(),key=`${site.id}?${query}&refresh=${tick}`;
 useEffect(()=>{let active=true;setBusy(true);setError(null);api<RiskRegisterPage>(`/sites/${site.id}/risk-assessment-register?${query}`).then(page=>{if(active)setResult({key,page});}).catch((e:Error)=>{if(active)setError({key,text:e.message});}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[site.id,query,key]);
 useEffect(()=>{onBusyChange?.(busy);return()=>onBusyChange?.(false);},[busy,onBusyChange]);
 const page=result?.key===key?result.page:null;
 function apply(clear=false){const value=clear?blank:{...draft,keyword:draft.keyword.trim()};setDraft(value);setApplied(value);setOffset(0);setTick(n=>n+1);}
 return <section><h2>평가 문서 목록</h2><p>현재 조회의 문서 목록입니다. 후속 없음은 안전 승인이나 전체 체인의 최신성 인증이 아닙니다. 등록 업체 연결이 없어 업체 필터는 없습니다.</p>
  <p>입력만 바꾼 동안 목록은 이전 적용 조건입니다. 조건 적용 후 새 결과를 조회합니다.</p>
  <fieldset disabled={busy}><legend>검색 조건</legend>
   <label>평가일 시작<input type="date" value={draft.dateFrom} onChange={e=>setDraft({...draft,dateFrom:e.target.value})}/></label>
   <label>평가일 종료<input type="date" value={draft.dateTo} onChange={e=>setDraft({...draft,dateTo:e.target.value})}/></label>
   <label>방법<select value={draft.method} onChange={e=>setDraft({...draft,method:e.target.value})}><option value="">모든 방법</option>{Object.entries(methods).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>
   <label>상태<select value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value})}><option value="">모든 상태</option>{Object.entries(statuses).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>
   <label>연결 관계<select value={draft.lineage} onChange={e=>setDraft({...draft,lineage:e.target.value})}><option value="all">전체 문서</option><option value="leaf">후속 없는 문서</option><option value="prior">후속 있는 이전 문서</option></select></label>
   <label>제목·작업 범위·작업명 문자 검색<input maxLength={100} value={draft.keyword} onChange={e=>setDraft({...draft,keyword:e.target.value})}/></label>
   <p>문자 그대로 부분 일치, 대소문자 구분. 평가일 양끝 포함, 생성일 검색 아님.</p>
   <button type="button" onClick={()=>apply()}>조건 적용 / 첫 페이지</button><button type="button" onClick={()=>apply(true)}>조건 초기화</button>
  </fieldset>
  <button type="button" disabled={busy} onClick={()=>{setOffset(0);setTick(n=>n+1);}}>현재 조건으로 처음부터 새로 조회</button>
  {busy&&<p role="status">조회 중…</p>}{error?.key===key&&<p role="alert">{error.text}</p>}
  {page&&<><p>적용 조건: 평가일 {page.query.dateFrom || "시작 제한 없음"} ~ {page.query.dateTo || "종료 제한 없음"} · {page.query.method ? methods[page.query.method] : "모든 방법"} · {page.query.status ? statuses[page.query.status] : "모든 상태"} · 문자 {page.query.keyword || "없음"}</p><p>현재 조건 {page.total}건 · 조회 {page.generatedAt} · 생성시각 내림차순/ID 오름차순. 페이지 사이 자료 변경으로 개수·위치가 달라질 수 있습니다.</p>
   {!page.items.length&&<p>현재 페이지 결과가 없습니다. 조건 또는 첫 페이지를 다시 확인하세요.</p>}
   <ul>{page.items.map(r=><li key={r.id}><button type="button" disabled={busy} onClick={()=>onOpen(r.id)}>{r.title} / 평가일 {r.date} / {methods[r.method]} / {statuses[r.status]} / v{r.version}</button><p>작성 계정(현재 이름) {r.authorName} · {r.successorId?"후속 있는 이전 문서":"후속 없는 문서"}</p></li>)}</ul>
   <button type="button" disabled={busy||offset===0} onClick={()=>setOffset(Math.max(0,offset-50))}>이전 50</button><button type="button" disabled={busy||!page.hasMore} onClick={()=>setOffset(offset+50)}>다음 50</button>
  </>}
 </section>;
}
