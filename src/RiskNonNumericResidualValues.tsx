import type {ResidualContext} from '../server/risk-residuals';
export const emptyResidualAnswers=()=>({scenario:'',exposedGroup:'',exposurePath:'',harm:'',currentControls:''});
export type ResidualAnswers=ReturnType<typeof emptyResidualAnswers>;
export function RiskNonNumericResidualValues({context,outcome,setOutcome,answers,setAnswers,decision,setDecision,followupNotes,setFollowupNotes}:{context:ResidualContext;outcome:string;setOutcome:(v:string)=>void;answers:ResidualAnswers;setAnswers:(v:ResidualAnswers)=>void;decision:string;setDecision:(v:string)=>void;followupNotes:string;setFollowupNotes:(v:string)=>void}){
 const criteria=context.facts.criteria.body,hazard=context.facts.hazard;
 if(criteria.method==='checklist'){
  const id='checklistItemId' in hazard?hazard.checklistItemId:null,item=criteria.items.find(i=>i.id===id);
  return <><p>원 위험행의 고정 체크항목만 재평가합니다. 다른 항목 선택/점수 변환/전체 허용 판정 없음.</p><h4>{item?.prompt}</h4><p>{item?.guidance} · 항목 {id}</p>
  <label>해당 항목에 대한 새로운 사람 응답<select value={outcome} onChange={e=>setOutcome(e.target.value)}><option value="">미선택</option><option value="compliant">적합 (항목 한정)</option><option value="noncompliant">부적합 · 미해결 판단</option><option value="not_applicable">해당없음 (근거 필수)</option></select></label></>;
 }
 if(criteria.method!=='narrative')return null;
 return <><p>원 고정 질문에 대한 새로운 서술입니다. 원 평가 답변을 덮어쓰지 않으며 점수/허용 판정이 없습니다.</p>{(Object.keys(answers) as (keyof ResidualAnswers)[]).map(key=><label key={key}>{criteria.questions[key].prompt}<small>{criteria.questions[key].guidance}</small><textarea maxLength={key==='exposedGroup'?300:2000} value={answers[key]} onChange={e=>setAnswers({...answers,[key]:e.target.value})}/></label>)}
 <label>사람의 추가조치 판단<select value={decision} onChange={e=>setDecision(e.target.value)}><option value="">미선택</option><option value="planned">추가조치 제안 메모 있음 · 미배정/미실행</option><option value="none_proposed">추가조치 미제안 · 안전 허가 아님</option><option value="further_review">추가 판단 필요 · 미확정</option></select></label>
 <label>추가조치 제안 메모 (실행계획/계정배정 아님)<textarea maxLength={5000} value={followupNotes} onChange={e=>setFollowupNotes(e.target.value)}/></label><p>제안 있음은 구체 메모 필수, 미제안은 메모를 비워야 합니다. 추가 판단 필요는 미확정 그대로 기록할 수 있습니다. 실행 담당/기한 추적은 원 평가의 명시 정정 또는 새 평가에서 별도로 계획을 작성하세요. 이 메모로 조치가 생성되거나 원 계획 확인 조건이 바뀌지 않습니다.</p></>;
}
