import { blankCargo, riskNames, planFormName, type PlanForm, type PlanMeasurement, type PlanResponse } from '../server/work-plan-form-values';
function Answer({label,value,onChange}:{label:string;value:PlanResponse;onChange:(v:PlanResponse)=>void}){
 return <fieldset><legend>{label}</legend><label>기록 구분<select value={value.state||''} onChange={e=>onChange({...value,state:(e.target.value||null) as PlanResponse['state']})}><option value="">미입력</option><option value="provided">설명/대책 작성</option><option value="not_applicable">해당 없음 (사유 필요)</option></select></label><label>설명·대책 또는 해당 없음 사유<textarea maxLength={2000} value={value.note} onChange={e=>onChange({...value,note:e.target.value})}/></label></fieldset>;
}
function Measure({label,value,weight=false,onChange}:{label:string;value:PlanMeasurement;weight?:boolean;onChange:(v:PlanMeasurement)=>void}){
 return <fieldset><legend>{label}</legend><label>수기 값 (빈값은 미입력)<input inputMode="decimal" maxLength={14} value={value.value??''} onChange={e=>onChange({...value,value:e.target.value===''?null:e.target.value})}/></label><label>단위<select value={value.unit} onChange={e=>onChange({...value,unit:e.target.value as PlanMeasurement['unit']})}><option value="">단위 미입력</option>{weight?<option value="t">t (입력자가 확인)</option>:<><option value="m">m</option><option value="mm">mm</option></>}</select></label><label>입력 근거·매뉴얼/자료 확인 메모<textarea maxLength={1000} value={value.basis} onChange={e=>onChange({...value,basis:e.target.value})}/></label></fieldset>;
}
export function WorkPlanFormFields({value,onChange}:{value:PlanForm;onChange:(v:PlanForm)=>void}){
 return <section><h3>{planFormName(value)}</h3><p>아래는 자체 문서 완결 조건이며 법정 필수조건/작업허가/안전 승인 아닙니다. 초안은 미입력으로 저장할 수 있습니다. 제출/보관 전에 모든 설명 구분·사유와 수기 값·단위·근거를 채우고 굴착기 화물은1개 이상 작성합니다.0은 미입력과 다릅니다.</p><p>0~1,000,000, 소수6자리까지 정확한 십진수만 저장합니다. 단위 환산·중량 합산·안전하중 계산·서명·원본 페이지 재현은 제공하지 않습니다. 원자료의 인양높이 단위는 자동 추정하지 않습니다.</p>
 {(['terrain','groundwater','route'] as const).map((key,i)=><Answer key={key} label={['지형·지반','지하수 상태','운행경로 설명 (그림 아님)'][i]} value={value[key]} onChange={v=>onChange({...value,[key]:v})}/>)}
 {Object.entries(riskNames).map(([k,label])=><Answer key={k} label={label+' 위험 대책'} value={value.measures[k as keyof typeof riskNames]} onChange={v=>onChange({...value,measures:{...value.measures,[k]:v}})}/>)}
 {value.kind==='general_machine'?<Measure label="장비총중량" weight value={value.equipmentMass} onChange={v=>onChange({...value,equipmentMass:v})}/>:<>
 <Measure label="작업반경" value={value.radius} onChange={v=>onChange({...value,radius:v})}/><Measure label="인양높이" value={value.liftHeight} onChange={v=>onChange({...value,liftHeight:v})}/><Measure label="매뉴얼 정격하중 (입력자가 작업조건 확인)" weight value={value.ratedLoad} onChange={v=>onChange({...value,ratedLoad:v})}/>
 <button type="button" disabled={value.cargo.length>=6} onClick={()=>onChange({...value,cargo:[...value.cargo,blankCargo()]})}>화물 추가 (최대6개)</button>
 {value.cargo.map((c,i)=><fieldset key={i}><legend>화물{i+1}</legend><label>화물 설명<input maxLength={500} value={c.description} onChange={e=>onChange({...value,cargo:value.cargo.map((r,j)=>j===i?{...r,description:e.target.value}:r)})}/></label>{(['length','height','width','unitMass','otherMass'] as const).map((key,n)=><Measure key={key} label={['길이 L','높이 H','폭 W','단위화물중량','기타중량'][n]} weight={n>=3} value={c[key]} onChange={v=>onChange({...value,cargo:value.cargo.map((r,j)=>j===i?{...r,[key]:v}:r)})}/>)}<button type="button" onClick={()=>onChange({...value,cargo:value.cargo.filter((_,j)=>j!==i)})}>이 화물 제거</button></fieldset>)}
 </>}
 </section>;
}
