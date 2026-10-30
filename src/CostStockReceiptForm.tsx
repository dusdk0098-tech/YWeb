import { useState } from "react";
import { api } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import type { CostExpense } from "./cost-types";
import type { StockItem } from "./stock-types";
import type { CostStockRecord } from "../server/cost-stock-model";
export function CostStockReceiptForm({siteId,periodId,periodVersion,expense,item,onSaved,onDirtyChange,onBusyChange}:{siteId:string;periodId:string;periodVersion:number;expense:CostExpense;item:StockItem;onSaved:(v:{receipt:CostStockRecord;item:StockItem})=>void;onDirtyChange:(v:boolean)=>void;onBusyChange:(v:boolean)=>void}){
 const [quantity,setQuantity]=useState(""),[date,setDate]=useState(""),[reason,setReason]=useState(""),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const guard=useDraftGuard(!!(quantity||date||reason||confirm),busy,onDirtyChange,onBusyChange);
 async function save(){const path=`/sites/${siteId}/cost-periods/${periodId}/expenses/${expense.id}/stock-receipts`,value={periodVersion,expenseVersion:expense.version,itemId:item.id,itemVersion:item.version,quantity,effectiveDate:date,reason,confirmSeparatePhysicalQuantity:confirm};setBusy(true);setError("");try{onSaved(await api(path,"POST",value,guard.key(path,value)));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section><h3>비용 출처를 붙인 명시 입고</h3><p>비용행 {expense.description} · 금액 계산 수량 {expense.quantity} (단위 없음) · 금액 {expense.amount}원. 물리수량으로 변환하지 않습니다.</p><p>선택 품목 {item.name} / 단위 {item.unit} / 현재 잔량 {item.balance}. 실제 입고 사실과 수량을 별도로 확인하세요.</p>
  <fieldset disabled={busy}><label>실제 입고수량 ({item.unit})<input maxLength={24} value={quantity} onChange={e=>setQuantity(e.target.value)}/></label><label>입고 효력일<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>입고 사유<textarea maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
  <label><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>비용 수량과 물리수량은 별개이며 비용·마감본을 수정하지 않는 실제 입고 기록임을 확인했습니다.</label><button type="button" disabled={!confirm||!quantity||!date||!reason.trim()} onClick={()=>void save()}>입고 기록 생성</button></fieldset>
  <p>이미 수기 입고한 물량을 중복 기록하지 마세요. 기존 보호구 지급은 품목 잔량에서 별도 실행하며 구매 lot/수령 서명을 증명하지 않습니다.</p>{error&&<p role="alert">{error}</p>}
 </section>;
}
export function CostStockReceiptSummary({record}:{record:CostStockRecord}){
 const s=record.snapshot;return <section><h3>비용 연결 입고 {record.status==="active"?"유효":"전량 역분개 기록 있음"}</h3><p>당시 비용 {s.source.expense.description} / 비용 수량 {s.source.expense.quantity} (단위 없음) / 금액 {s.source.expense.amount}원</p><p>물리 입고 {s.physicalQuantity} {s.item.unit} / 당시 품목 {s.item.name} / 효력일 {s.effectiveDate}</p><p>당시 비용행 v{s.source.expense.version} / 현재 v{record.currentSource.expenseVersion} · {record.currentSource.status} · 원장 {record.currentSource.periodStatus}</p><p>현재 비용 {record.currentSource.description} / 계산 수량 {record.currentSource.quantity} × 단가 {record.currentSource.unitPriceWon} = {record.currentSource.amount}원 (물리수량 아님)</p>{record.currentSource.changed&&<p>비용 출처가 당시 기록과 다릅니다. 입고와 현재 잔량은 자동 조정하지 않았습니다.</p>}{s.source.closure&&<p>당시 마감본 {s.source.closure.id} / hash {s.source.closure.hash}</p>}<p>원 이동 {s.movementId} / hash {s.movementHash} · 기록계정 {s.actor.name} · {s.at}</p>{record.reversal&&<p>전량 역분개 {record.reversal.movementId} · {record.reversal.effectiveDate} · {record.reversal.reason}. 비용은 변경하지 않았습니다.</p>}<p>품목 단위 잔량 풀입니다. 특정 구매 lot의 미사용/개인 지급/안전 적합성을 증명하지 않습니다.</p></section>;
}
