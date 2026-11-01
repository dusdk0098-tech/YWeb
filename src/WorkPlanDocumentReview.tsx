import { useEffect,useState } from "react";
import { api,type Site,type User } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import { WorkPlanPicker } from "./WorkPlanPicker";
import type { WorkPlan } from "./work-plan-types";
import type { workPlanReviewView } from "../server/work-plan-review-model";
type View=ReturnType<typeof workPlanReviewView>;
export function WorkPlanDocumentReview({site,user,record,disabled,onSaved,onRevision,onDirtyChange,onBusyChange}:{site:Site;user:User;record:WorkPlan;disabled:boolean;onSaved:(next:WorkPlan)=>void;onRevision:(next:WorkPlan)=>void;onDirtyChange:(v:boolean)=>void;onBusyChange:(v:boolean)=>void}){
 const [view,setView]=useState<View|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[tick,setTick]=useState(0),[mode,setMode]=useState<""|"submit"|"accepted"|"returned">(""),[reason,setReason]=useState(""),[authorId,setAuthorId]=useState(""),[events,setEvents]=useState<{items:{id:number;version:number;event:string;actor_name:string;at:string;reason:string;body:string}[];hasMore:boolean}|null>(null),[offset,setOffset]=useState(0);
 const base=`/sites/${site.id}/work-plans/${record.id}`,guard=useDraftGuard(!!mode||!!reason||!!authorId,busy,onDirtyChange,onBusyChange);
 useEffect(()=>{let active=true;setBusy(true);setError("");setView(null);Promise.all([api<View>(base+"/document-review"),api<NonNullable<typeof events>>(base+`/review-events?offset=${offset}`)]).then(([v,e])=>{if(active){setView(v);setEvents(e);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[base,record.version,tick,offset]);
 function clear(){setMode("");setReason("");setAuthorId("");}
 async function save(){if(disabled||busy||!mode)return;setBusy(true);setError("");try{
  if(mode==="submit"){
   const input={version:record.version,reason,confirmDocumentOnly:true},path=base+"/submit",next=await api<WorkPlan>(path,"POST",input,guard.key(path,input));clear();onSaved(next);
  }else{
   const input={version:view!.review!.version,submissionHash:view!.review!.submission_hash,decision:mode,reason,confirmDocumentOnly:true,...(mode==="returned"?{authorId}:{})},path=base+"/review";
   const next=await api<{record:WorkPlan;documentReview:View;nextDraft:WorkPlan|null}>(path,"POST",input,guard.key(path,input));clear();if(next.nextDraft)onRevision(next.nextDraft);else{onSaved(next.record);setView(next.documentReview);setTick(v=>v+1);}
  }
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section aria-label="작업계획 문서 제출·검토"><h3>문서 제출·검토</h3><p>입력 문서의 검토 기록입니다. 공학 검토·작업허가·안전 승인·선임·동의/서명이나 원본17종 동등성 증명이 아닙니다. 제출 인쇄는 당시 고정본이며 현재 검토결정을 자동 덧쓰지 않습니다.</p>
 {error&&<p role="alert">{error}</p>}{view?.kind==="unreviewed_archive"&&<p>기록 보관본 · 문서검토 이력 없음. 과거 보관을 수락으로 추정하지 않습니다.</p>}
 {view?.review&&<><p>문서 상태: {{submitted:"제출·문서검토 대기",accepted:"문서 수락 기록",returned:"보완반려·연결 초안 생성"}[view.review.status]} · 검토 버전 {view.review.version}</p><p>고정 제출 SHA-256: {view.review.submission_hash}</p><p>{view.referenceState?.message}</p>{view.review.decision&&<p>당시 결정: {view.review.decision.reason} · {view.review.decision.actor.name} · {view.review.decision.at} · 당시 참조 {view.review.decision.sourceStateAtDecision}</p>}</>}
 <button disabled={disabled||busy||!!mode} onClick={()=>setTick(v=>v+1)}>현재 문서 검토/참조 상태 조회</button>
 {record.status==="draft"&&record.author_id===user.id&&site.role!=="viewer"&&<button disabled={disabled||busy||!!mode||!record.source_capture} onClick={()=>setMode("submit")}>작성자가 문서 제출</button>}
 {view?.review?.status==="submitted"&&site.role==="manager"&&record.author_id!==user.id&&<><button disabled={disabled||busy||!!mode||view.referenceState?.state!=="current"} onClick={()=>setMode("accepted")}>문서 수락 기록</button><button disabled={disabled||busy||!!mode} onClick={()=>setMode("returned")}>보완반려·새 초안</button></>}
 {mode&&<fieldset disabled={disabled||busy}><legend>{mode==="submit"?"작성자 제출":mode==="accepted"?"다른 관리자 문서 수락":"보완반려와 새 작성자 지정"}</legend><label>사유<textarea maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>{mode==="returned"&&<><WorkPlanPicker path={`/sites/${site.id}/work-plans/authors`} label="현재 현장 보완 초안 작성계정" disabled={disabled||busy} onSelect={setAuthorId}/><p>선택 계정 {authorId||"미선택"}. 원 제출본은 보존하고 참조취합/문서수락은 새 초안으로 상속하지 않습니다.</p></>}
 <button disabled={!reason.trim()||(mode==="returned"&&!authorId)} onClick={()=>{if(window.confirm("문서 기록일 뿐 실제 작업 허가/안전 인증이 아닙니다. 저장할까요?"))void save();}}>명시 저장</button><button onClick={()=>{if(guard.canLeave())clear();}}>취소</button></fieldset>}
 <h4>제출·검토 고정 이력</h4>{events?.items.map(e=><details key={e.id}><summary>검토v{e.version} · {e.event} · {e.actor_name} · {e.at}</summary><p>{e.reason}</p><pre>{e.body}</pre></details>)}<button disabled={disabled||busy||!!mode||!offset} onClick={()=>setOffset(v=>v-50)}>이전 50</button><button disabled={disabled||busy||!!mode||!events?.hasMore} onClick={()=>setOffset(v=>v+50)}>다음 50</button>
 </section>;
}
