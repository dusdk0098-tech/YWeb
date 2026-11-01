import { useEffect,useState } from "react";
import { api,type Site,type User,type Meeting } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import { WorkPlanPicker } from "./WorkPlanPicker";
import { CompanyPpeHistory } from "./CompanyPpeHistory";
import type { minutesFollowupRecord } from "../server/minutes-model";
type Followup=ReturnType<typeof minutesFollowupRecord>;
const labels={assigned:"배정·보고 대기",reported:"담당 계정 보고",verified:"다른 관리자 확인 기록"};
export function MinutesFollowupsPanel({site,user,meeting,onClose,onDirtyChange,onBusyChange}:{site:Site;user:User;meeting:Meeting;onClose:()=>void;onDirtyChange:(v:boolean)=>void;onBusyChange:(v:boolean)=>void}){
 const [page,setPage]=useState<{items:Followup[];hasMore:boolean}>({items:[],hasMore:false}),[offset,setOffset]=useState(0),[tick,setTick]=useState(0),[opened,setOpened]=useState<Followup|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [mode,setMode]=useState<""|"create"|"assign"|"report"|"verify"|"reopen">(""),[index,setIndex]=useState(0),[assignee,setAssignee]=useState(""),[due,setDue]=useState(""),[reason,setReason]=useState(""),[text,setText]=useState(""),[claimed,setClaimed]=useState("");
 const dirty=!!mode,guard=useDraftGuard(dirty,busy,onDirtyChange,onBusyChange),base=`/sites/${site.id}/minutes-followups`;
 useEffect(()=>{if(opened)return;let active=true;setBusy(true);setError("");api<typeof page>(`${base}?minutesId=${meeting.id}&offset=${offset}`).then(v=>{if(active)setPage(v);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[base,meeting.id,offset,tick,opened]);
 function clear(){setMode("");setAssignee("");setDue("");setReason("");setText("");setClaimed("");}
 async function save(){if(busy||!mode)return;setBusy(true);setError("");try{
  const path=mode==="create"?`/sites/${site.id}/minutes/${meeting.id}/followups`:`${base}/${opened!.id}/${mode}`;
  const payload=mode==="create"?{version:meeting.version,snapshotHash:meeting.snapshot!.hash,actionIndex:index,assigneeId:assignee,due,reason,confirmManualTracking:true}:mode==="assign"?{version:opened!.version,assigneeId:assignee,due,reason}:mode==="report"?{version:opened!.version,text,claimedLocalDate:claimed,reason,confirmHumanReport:true}:mode==="verify"?{version:opened!.version,note:text,reportHash:opened!.reportHash,reason,confirmHumanRecord:true}:{version:opened!.version,reason};
  const next=await api<Followup>(path,"POST",payload,guard.key(path,payload));setOpened(next);clear();
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function open(id:string){setBusy(true);setError("");try{setOpened(await api<Followup>(`${base}/${id}`));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section><button disabled={busy} onClick={()=>{if(guard.canLeave()){clear();onClose();}}}>확정 회의록으로</button><h2>{meeting.title} · 별도 후속조치</h2>
 <p>원 회의의 결정/항목·당시 수기 상태를 보존한 별도 기록입니다. 보고·다른 관리자 확인은 실제 이행 관측/참석/서명·법적 인증이 아닙니다. 회의 정정이나 후속보고로 원문·인쇄가 바뀌지 않습니다.</p>
 {error&&<p role="alert">{error}</p>}
 {opened?<><h3>{opened.source.action.task} · {labels[opened.status]}</h3><p>고정 출처 v{opened.source.snapshotVersion} · {opened.source.snapshotHash}</p><p>당시 결정: {opened.source.decisions}</p><p>당시 담당 입력: {opened.source.action.owner} · 당시 수기 상태: {opened.source.action.status}</p><p>현재 배정 계정 ID: {opened.assignee_id} · 예정일 {opened.due}</p>{opened.sourceHasSuccessor&&<p>원 회의의 정정본이 있습니다. 기존 후속기록은 유지됩니다.</p>}
 {opened.report&&<p>보고: {opened.report.text} · 주장일 {opened.report.claimedLocalDate} · {opened.report.actor.name} · 기록시각 {opened.report.at}</p>}{opened.verification&&<p>확인: {opened.verification.note} · {opened.verification.actor.name} · {opened.verification.at}</p>}
 <button disabled={busy||dirty} onClick={()=>{setOpened(null);setTick(v=>v+1);}}>후속목록</button>
 {site.role!=="viewer"&&opened.assignee_id===user.id&&opened.status!=="verified"&&<button disabled={busy||dirty} onClick={()=>setMode("report")}>담당자 보고·보고정정</button>}
 {site.role==="manager"&&<><button disabled={busy||dirty||opened.status==="verified"} onClick={()=>{setMode("assign");setDue(opened.due);}}>담당/예정일 재배정</button>{opened.status==="reported"&&opened.assignee_id!==user.id&&opened.report?.actor.id!==user.id&&<button disabled={busy||dirty} onClick={()=>setMode("verify")}>다른 관리자의 확인 기록</button>}{opened.status==="verified"&&<button disabled={busy||dirty} onClick={()=>setMode("reopen")}>사유로 재개방</button>}</>}
 <CompanyPpeHistory path={`${base}/${opened.id}`} version={opened.version}/>
 </>:<><button disabled={busy||dirty} onClick={()=>setTick(v=>v+1)}>목록 다시 조회</button>{site.role==="manager"&&!meeting.successorId&&!!meeting.actions.length&&<button disabled={busy||dirty} onClick={()=>{setMode("create");setDue(meeting.actions[0].due);}}>고정 후속항목의 추적 시작</button>}
 <ul>{page.items.map(r=><li key={r.id}><button disabled={busy||dirty} onClick={()=>void open(r.id)}>{r.source.action.task} · {labels[r.status]} · {r.due}</button></li>)}</ul><button disabled={busy||dirty||!offset} onClick={()=>setOffset(v=>v-50)}>이전 50</button><button disabled={busy||dirty||!page.hasMore} onClick={()=>setOffset(v=>v+50)}>다음 50</button></>}
 {mode&&<fieldset disabled={busy}><legend>{mode==="create"?"추적 시작":mode==="assign"?"재배정":mode==="report"?"보고 기록":mode==="verify"?"확인 기록":"재개방"}</legend>
 {mode==="create"&&<label>원문 후속항목<select value={index} onChange={e=>{setIndex(Number(e.target.value));setDue(meeting.actions[Number(e.target.value)].due);}}>{meeting.actions.map((a,i)=><option key={i} value={i}>{i+1}. {a.task} · 당시 {a.status}</option>)}</select></label>}
 {(mode==="create"||mode==="assign")&&<><WorkPlanPicker path={`${base}/assignees`} label="현재 현장 담당 계정" disabled={busy} onSelect={setAssignee}/><p>선택 계정 {assignee||"없음"}</p><label>예정일<input type="date" value={due} onChange={e=>setDue(e.target.value)}/></label></>}
 {(mode==="report"||mode==="verify")&&<label>사람이 기록한 내용<textarea maxLength={10000} value={text} onChange={e=>setText(e.target.value)}/></label>}
 {mode==="report"&&<label>사람이 주장한 이행일<input type="date" value={claimed} onChange={e=>setClaimed(e.target.value)}/></label>}
 <label>사유<input maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label><button disabled={!reason.trim()} onClick={()=>{if(window.confirm("이 계정의 수기 기록이며 실제 이행/서명 인증이 아닙니다. 저장할까요?"))void save();}}>명시 저장</button><button onClick={()=>{if(guard.canLeave())clear();}}>입력 취소</button>
 </fieldset>}{busy&&<p role="status">현재 권한으로 처리 중…</p>}</section>;
}
