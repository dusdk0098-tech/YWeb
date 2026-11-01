import { useEffect,useState } from "react";
import { api,type Site,type User } from "./api";
import type { RiskInbox,RiskInboxItem,RiskInboxKind } from "../server/risk-inbox";
import type { RiskAction } from "../server/risk-actions";
import type { PublicationView } from "../server/risk-publication-model";
import type { RiskAssessmentRecord } from "../server/risk-core";
import { RiskActionEditor } from "./RiskActionEditor";
import { RiskPublicationView } from "./RiskPublicationView";
import { RiskAssessmentEditor } from "./RiskAssessmentEditor";
const labels={actions:"내 조치 보고 대기",publications:"내 게시 확인·중지",reviews:"내가 검토 가능한 문서"};
export function RiskInboxRows({page,onOpen,disabled}:{page:RiskInbox;onOpen:(item:RiskInboxItem)=>void;disabled:boolean}) {
 return <><p>조회 시각 {page.retrievedAt} · 현재 현장·내 계정 기준입니다. 현장 전체 현황이 아닙니다.</p>
  <p>내 배정·보고 대기 {page.counts.ownAssigned} (현재 보고 가능 {page.counts.ownReportAllowed}) · 내 게시 확인 가능 {page.counts.ownPublicationAllowed} · 출처 변경으로 확인 중지 {page.counts.ownPublicationStopped}</p>
  {page.counts.reviewEligible!==null&&<p>내가 검토 가능한 문서 {page.counts.reviewEligible} (내 작성 문서 제외)</p>}
  <ul>{page.items.map(r=><li key={r.kind+":"+r.id}><button disabled={disabled} onClick={()=>onOpen(r)}>{r.title} · 제출 v{r.submissionVersion}{r.task?` · ${r.task}`:""}{r.due?` · 예정 ${r.due}`:""}</button>
    {r.sourceHasSuccessor&&<p>후속 평가 있음 · 당시 원문 참조. 기존 조치 배정은 취소되지 않습니다.</p>}
    {r.stopReason==="current_role_cannot_report"&&<p>내 배정 기록은 남아 있으나 현재 역할은 보고할 수 없습니다.</p>}
    {r.stopReason==="source_not_current"&&<p>새 계정 확인 중지 · 미이행 업무로 세지 않습니다.</p>}
  </li>)}</ul>{!page.items.length&&<p>이 페이지에 표시할 내 업무가 없습니다.</p>}</>;
}
export function RiskInboxPanel({site,user,onClose,onDirtyChange,onBusyChange}:{site:Site;user:User;onClose:()=>void;onDirtyChange:(v:boolean)=>void;onBusyChange:(v:boolean)=>void}) {
 const [kind,setKind]=useState<RiskInboxKind>("actions"),[offset,setOffset]=useState(0),[tick,setTick]=useState(0),[page,setPage]=useState<RiskInbox|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [opened,setOpened]=useState<{kind:"actions";row:RiskAction}|{kind:"publications";row:PublicationView}|{kind:"reviews";row:RiskAssessmentRecord}|null>(null);
 useEffect(()=>{if(opened)return;let active=true;setBusy(true);setPage(null);setError("");
  api<RiskInbox>(`/sites/${site.id}/risk-inbox?kind=${kind}&offset=${offset}`).then(r=>{if(active)setPage(r);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});
  return()=>{active=false;};
 },[site.id,kind,offset,tick,opened]);
 useEffect(()=>{onBusyChange(busy);return()=>onBusyChange(false);},[busy,onBusyChange]);
 function back(){setOpened(null);onDirtyChange(false);setTick(v=>v+1);}
 const common={site,onClose:back,onDirtyChange,onBusyChange};
 if(opened?.kind==="actions")return <RiskActionEditor {...common} user={user} initial={opened.row}/>;
 if(opened?.kind==="publications")return <RiskPublicationView {...common} initial={opened.row}/>;
 if(opened?.kind==="reviews")return <RiskAssessmentEditor {...common} user={user} method={opened.row.body.method} initial={opened.row}/>;
 async function open(r:RiskInboxItem){setBusy(true);setError("");try{
   if(r.kind==="actions")setOpened({kind:r.kind,row:await api<RiskAction>(`/sites/${site.id}/risk-actions/${r.id}`)});
   else if(r.kind==="publications")setOpened({kind:r.kind,row:await api<PublicationView>(`/sites/${site.id}/risk-publications/${r.id}`)});
   else setOpened({kind:r.kind,row:await api<RiskAssessmentRecord>(`/sites/${site.id}/risk-assessments/${r.id}`)});
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section><button disabled={busy} onClick={onClose}>위험성평가 목록으로</button><h1>{site.name} · 내 위험성평가 업무</h1>
  <p>사용자 조회로 갱신되는 업무목록입니다. 알림 발송·전달·열람 추적을 하지 않으며 목록을 열어도 보고·확인 기록은 생성되지 않습니다. 철회/확인 완료 게시본은 기존 게시 이력에서 볼 수 있습니다.</p>
  <nav>{(["actions","publications",...(site.role==="manager"?["reviews"]:[])] as RiskInboxKind[]).map(k=><button key={k} disabled={busy||kind===k} onClick={()=>{setKind(k);setOffset(0);}}>{labels[k]}</button>)}</nav>
  <button disabled={busy} onClick={()=>{setOffset(0);setTick(v=>v+1);}}>내 업무 다시 조회</button>
  {error&&<p role="alert">{error}</p>}{busy&&<p role="status">현재 권한으로 조회 중…</p>}
  {page&&<RiskInboxRows page={page} disabled={busy} onOpen={r=>void open(r)}/>}
  <button disabled={busy||!offset} onClick={()=>setOffset(v=>Math.max(0,v-50))}>이전 50</button><button disabled={busy||!page?.hasMore} onClick={()=>setOffset(v=>v+50)}>다음 50</button>
 </section>;
}
