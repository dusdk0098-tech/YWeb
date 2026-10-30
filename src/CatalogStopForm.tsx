import {useState} from "react";
export function CatalogStopForm({busy,onDirtyChange,onStop}:{busy:boolean;onDirtyChange:(dirty:boolean)=>void;onStop:(reason:string)=>void}){
 const [reason,setReason]=useState(""),[confirmed,setConfirmed]=useState(false);
 return <form onSubmit={e=>{e.preventDefault();if(confirmed&&reason.trim()&&!busy)onStop(reason.trim());}}>
 <h3>선택 게시본의 신규사용 중지</h3><p>이 버전에는 해제가 없습니다. 기존 일지와 보관본은 유지되며 개정/새 게시/다른 게시본 선택은 자동 실행하지 않습니다. 사유는 이 현장의 조회자에게 보입니다.</p>
 <fieldset disabled={busy}><label>중지 사유<textarea required maxLength={1000} value={reason} onChange={e=>{setReason(e.target.value);setConfirmed(false);onDirtyChange(!!e.target.value);}}/></label>
 <label><input type="checkbox" checked={confirmed} onChange={e=>{setConfirmed(e.target.checked);onDirtyChange(!!reason||e.target.checked);}}/>신규 사용만 중지하고 기존 기록을 바꾸지 않으며, 이 버전에서 해제할 수 없음을 확인했습니다.</label>
 <button disabled={!confirmed||!reason.trim()}>선택 게시본 신규사용 중지</button></fieldset></form>;
}
