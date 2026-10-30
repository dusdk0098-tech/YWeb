import type { PpeReturnView } from "./ppe-return-types";
export function PpeReturnSummary({data,unit}:{data:Pick<PpeReturnView,"entries"|"summary">|null;unit:string}){
 return <section className="panel" aria-label="반납 누계와 원본"><h3>반납 누계와 고정 이력</h3>
 {data?<><p>반납 누계 {data.summary.returnedQuantity} · 남은 수량 {data.summary.remainingQuantity} {unit} · 부분 기록 {data.summary.partialCount}/3 · {data.summary.terminal?"종결 · 취소 불가":"미종결"}</p>
 {data.entries.map(entry=><article key={entry.id}><strong>{entry.kind==="partial"?"부분 반납":entry.kind==="cancel"?"부분 반납 오류취소":"잔여 전량 종결"} · {entry.quantity}</strong><p>{entry.effectiveDate} · {entry.reason}</p><p>이동 {entry.movementId} · 기록 {entry.id}{entry.cancelsId?` · 취소대상 ${entry.cancelsId}`:""}</p></article>)}</>:<p>누계 조회 중 또는 실패 · 조회 전에는 반납할 수 없습니다.</p>}
 </section>;
}
