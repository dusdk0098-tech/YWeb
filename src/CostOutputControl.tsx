import { useState } from "react";
import { api } from "./api";
import type { CostOutputContext, OutputSelection } from "../server/cost-output";
export function CostOutputControl({base,selection={},disabled=false}:{base:string;selection?:OutputSelection;disabled?:boolean}) {
 const [context,setContext]=useState<CostOutputContext|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const query=new URLSearchParams(selection).toString();
 async function prepare(){setBusy(true);setContext(null);setError('');try{setContext(await api<CostOutputContext>(`${base}/output/prepare?${query}`));}catch(error){setError((error as Error).message);}finally{setBusy(false);}}
 return <section><h4>금융 자료 출력 최신성 확인</h4><p>저장된 금융 자료만 확인합니다. 증빙 최신성·실제 인쇄/PDF 완료를 확인하지 않습니다. 과거 마감본은 정상적인 역사 기록입니다.</p><button disabled={disabled||busy} onClick={()=>void prepare()}>출력 다시 준비</button>{error&&<p role="alert">최신 여부 확인 불가: {error}</p>}{context&&!disabled&&!busy&&<><p>{context.month} · {context.periodId} · 현재 v{context.currentVersion} {context.currentStatus} · 조회 {context.queriedAt}</p><p>{context.status==='historical'?'과거 고정 기록 — 현재 원장을 대신하지 않습니다.':'조회 시 현재 금융 자료와 일치 — 이후 변경 가능'}</p><p>지문 {context.fingerprint}</p><a target="_blank" rel="noreferrer" href={`/api${base}/output/print?${query}${query?'&':''}expectedFingerprint=${context.fingerprint}`}>현재성 재검증 후 HTML 열기</a><p>열기 전에 변경되면 중단됩니다. 다시 준비하세요. 이 표시는 인쇄 완료 기록이 아닙니다.</p></>}</section>;
}
