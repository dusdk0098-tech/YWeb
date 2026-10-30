import { useEffect,useState } from 'react';
import { api } from './api';
import { packetKinds,type PlanPacket,type PacketKind,type PacketRow } from '../server/work-plan-packet-values';
type File={id:string;filename:string;sha256:string;attached:number};
export function WorkPlanPacketFields({siteId,planId,version,equipmentIds,value,onChange,onBusy}:{siteId:string;planId?:string;version?:number;equipmentIds:string[];value:PlanPacket;onChange:(v:PlanPacket)=>void;onBusy:(v:boolean)=>void}){
 const [files,setFiles]=useState<File[]|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;setFiles(null);setError('');if(!planId)return;onBusy(true);api<File[]>(`/sites/${siteId}/work-plans/${planId}/attachments`).then(v=>{if(active)setFiles(v);}).catch(e=>{if(active)setError((e as Error).message);}).finally(()=>{if(active)onBusy(false);});return()=>{active=false;onBusy(false);};},[siteId,planId,version,onBusy]);
 const used=new Set(value.rows.map(r=>r.kind));
 function row(i:number,patch:Partial<PacketRow>){onChange({...value,rows:value.rows.map((r,j)=>i===j?{...r,...patch}:r)});}
 return <section><h3>선택 장비1대의 서류 참조 목록</h3><p>전체 장비의 법정 서류 완비 확인이 아닙니다. 사용자가 파일을 분류해 연결하거나 미확보/해당 없음과 사유를 기록합니다. 파일 안전성·면허/보험/교육/검사 유효성·선임/서명을 판정하지 않습니다. 같은 파일을 여러 분류에 연결해도 여러 증명서를 인증한 것이 아닙니다.</p>
 <label>계획에서 선택한 장비1대<select value={value.equipmentId||''} onChange={e=>onChange({...value,equipmentId:e.target.value||null})}><option value="">장비 미선택</option>{equipmentIds.map(id=><option key={id} value={id}>{id}</option>)}{value.equipmentId&&!equipmentIds.includes(value.equipmentId)&&<option value={value.equipmentId}>현재 선택에서 빠진 장비 · {value.equipmentId}</option>}</select></label>
 {!planId&&<p>초안을 먼저 저장한 뒤 기존 원본 첨부 화면에서 파일을 추가하세요.</p>}{error&&<p role="alert">파일 목록 확인 불가: {error}. 파일 없음으로 해석하지 마세요. 계획을 다시 열어 조회하세요.</p>}{planId&&!files&&!error&&<p>현재 파일 목록 조회 중</p>}
 <p>최대12개 분류. 제출/보관하려면1개 이상 행의 구분·사유를 입력하고 파일 참조에는 현재 활성 파일을 연결하세요. 이는 자체 기록 완결 조건입니다. 정정 초안의 파일/구분/메모는 초기화됩니다.</p>
 {Object.entries(packetKinds).map(([kind,label])=><button type="button" key={kind} disabled={used.has(kind as PacketKind)||value.rows.length>=12} onClick={()=>onChange({...value,rows:[...value.rows,{kind:kind as PacketKind,state:null,fileId:null,note:''}]})}>{label} 행 추가</button>)}
 {value.rows.map((r,i)=><fieldset key={r.kind}><legend>{packetKinds[r.kind]}</legend><label>기록 구분<select value={r.state||''} onChange={e=>row(i,{state:(e.target.value||null) as PacketRow['state'],fileId:null})}><option value="">미입력</option><option value="linked">파일 참조</option><option value="missing">미확보로 기록</option><option value="not_applicable">해당 없음으로 기록</option></select></label>
 {r.state==='linked'&&<><label>동일 계획의 활성 첨부<select disabled={!files} value={r.fileId||''} onChange={e=>row(i,{fileId:e.target.value||null})}><option value="">파일 미선택</option>{files?.filter(f=>f.attached===1).map(f=><option key={f.id} value={f.id}>{f.filename} · {f.id}</option>)}{r.fileId&&!files?.some(f=>f.id===r.fileId&&f.attached===1)&&<option value={r.fileId}>참조 재확인 필요 · {r.fileId}</option>}</select></label>{files&&r.fileId&&!files.some(f=>f.id===r.fileId&&f.attached===1)&&<p role="alert">파일이 없거나 분리되어 참조 불가입니다. 재선택하거나 미확보/해당 없음으로 수정하세요.</p>}</>}
 <label>사용자 확인 메모 / 미확보·해당 없음 사유<textarea maxLength={1000} value={r.note} onChange={e=>row(i,{note:e.target.value})}/></label><button type="button" onClick={()=>onChange({...value,rows:value.rows.filter((_,j)=>j!==i)})}>이 분류 제거</button></fieldset>)}
 </section>;
}
