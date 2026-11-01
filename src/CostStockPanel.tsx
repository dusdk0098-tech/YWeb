import {useEffect,useState} from "react";
import {api,type Site} from "./api";
import {useDraftGuard} from "./useDraftGuard";
import {WorkPlanPicker} from "./WorkPlanPicker";
import {CostStockReceiptForm,CostStockReceiptSummary} from "./CostStockReceiptForm";
import type {CostStockRecord} from "../server/cost-stock-model";
import type {CostExpense} from "./cost-types";
import type {StockItem} from "./stock-types";
import type {PpeRecord} from "./company-ppe-types";
import {StockEditor} from "./StockEditor";
import {PpeCreate} from "./PpeCreate";
import {PpeEditor} from "./PpeEditor";
type Context={periodVersion:number;periodStatus:string;expense:CostExpense;activeReceiptId:string|null;items:CostStockRecord[];hasMore:boolean};
export function CostStockPanel({site,periodId,expenseId,onClose,onDirtyChange,onBusyChange}:{site:Site;periodId:string;expenseId:string;onClose:()=>void;onDirtyChange:(v:boolean)=>void;onBusyChange:(v:boolean)=>void}){
 const [context,setContext]=useState<Context|null>(null),[offset,setOffset]=useState(0),[tick,setTick]=useState(0),[itemId,setItemId]=useState(""),[item,setItem]=useState<{id:string;value:StockItem}|null>(null),[action,setAction]=useState<{kind:"reverse"|"stock"|"ppe";row:CostStockRecord}|null>(null),[ppe,setPpe]=useState<PpeRecord|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[itemLoading,setItemLoading]=useState(false),[error,setError]=useState(""),[childDirty,setChildDirty]=useState(false),[childBusy,setChildBusy]=useState(false),[date,setDate]=useState(""),[reason,setReason]=useState(""),[confirm,setConfirm]=useState(false);
 const base=`/sites/${site.id}`,path=`${base}/cost-periods/${periodId}/expenses/${expenseId}/stock-receipts`,selectedItemId=action?.row.item_id??itemId;
 const guard=useDraftGuard(childDirty||!!date||!!reason||confirm,busy||loading||itemLoading||childBusy,onDirtyChange,onBusyChange);
 useEffect(()=>{let active=true;setLoading(true);setContext(null);setError("");api<Context>(`${path}?offset=${offset}`).then(v=>{if(active)setContext(v);}).catch((e:Error)=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[path,offset,tick]);
 useEffect(()=>{setItem(null);setItemLoading(false);if(!selectedItemId)return;let active=true;setItemLoading(true);api<StockItem>(`${base}/stock-items/${selectedItemId}`).then(v=>{if(active)setItem({id:selectedItemId,value:v});}).catch((e:Error)=>{if(active)setError(e.message);}).finally(()=>{if(active)setItemLoading(false);});return()=>{active=false;};},[base,selectedItemId,tick]);
 const currentItem=item?.id===selectedItemId?item.value:null;
 function reset(){setAction(null);setPpe(null);setItemId("");setDate("");setReason("");setConfirm(false);setChildDirty(false);setChildBusy(false);setTick(n=>n+1);}
 function open(kind:"reverse"|"stock"|"ppe",row:CostStockRecord){if(!guard.canLeave())return;setDate("");setReason("");setConfirm(false);setItemId("");setAction({kind,row});}
 async function reverse(){if(!action||!currentItem)return;const url=`${base}/cost-stock-receipts/${action.row.id}/reverse`,value={itemVersion:currentItem.version,effectiveDate:date,reason,confirmFinanceUnchanged:confirm};setBusy(true);setError("");try{await api(url,"POST",value,guard.key(url,value));reset();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const common={site,onDirtyChange:setChildDirty,onBusyChange:setChildBusy,onClose:reset};
 if(ppe)return <PpeEditor {...common} initial={ppe}/>;
 if(action?.kind==="stock"&&currentItem)return <StockEditor {...common} initial={currentItem}/>;
 if(action?.kind==="ppe"&&currentItem)return <><p>비용 구매 lot가 아닌 같은 품목 잔량에서 별도 지급합니다. 수량/대상/실물 확인은 새로 입력하세요.</p><PpeCreate {...common} initialItemId={currentItem.id} onSaved={setPpe}/></>;
 return <section><button disabled={busy||loading||itemLoading||childBusy} onClick={()=>{if(guard.canLeave())onClose();}}>사용내역으로</button><h2>비용 출처 입고 / 연결 이력</h2><p>재고 동작은 비용·마감본을 바꾸지 않고 비용 취소는 재고를 바꾸지 않습니다. 구매 lot/개인 수령/안전 적합성 증명이 아닙니다.</p>
  {error&&<p role="alert">{error}</p>}{(loading||itemLoading)&&<p>현재 출처/품목 조회 중…</p>}
  <button disabled={busy||loading||itemLoading||childBusy} onClick={()=>{if(guard.canLeave())reset();}}>입력을 버리고 현재 상태 다시 조회</button>
  {action?.kind==="reverse"&&currentItem?<section><CostStockReceiptSummary record={action.row}/><p>현재 잔량 {currentItem.balance} {currentItem.unit}. 원 입고 전량 {action.row.snapshot.physicalQuantity}을 반대로 기록합니다. 부족하면 거부하며 허위 반납/조정으로 우회하지 마세요.</p><fieldset disabled={busy}><label>역분개 효력일<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>실제 정정 사유<textarea maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label><label><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>비용/마감본은 바꾸지 않는 전량 역분개임을 확인했습니다.</label><button disabled={!confirm||!date||!reason.trim()} onClick={()=>void reverse()}>전량 역분개 기록</button></fieldset></section>:context&&!action&&<>
   <p>현재 원장 {context.periodStatus} v{context.periodVersion} · 비용행 {context.expense.status} v{context.expense.version}</p>
   {context.expense.status==="active"&&!context.activeReceiptId?<><WorkPlanPicker path={`${base}/stock-items`} label="기존 품목 선택 (수량은 별도 입력)" disabled={busy||childBusy} onSelect={id=>{if(guard.canLeave())setItemId(id);}}/>{currentItem&&<CostStockReceiptForm key={`${currentItem.id}:${currentItem.version}:${context.expense.version}`} siteId={site.id} periodId={periodId} periodVersion={context.periodVersion} expense={context.expense} item={currentItem} onDirtyChange={setChildDirty} onBusyChange={setChildBusy} onSaved={()=>{reset();setOffset(0);}}/>}</>:<p>{context.activeReceiptId?"활성 연결 입고가 있어 중복 생성할 수 없습니다.":"취소 비용행에는 새 입고를 연결하지 않습니다."}</p>}
   {context.items.map(row=><article key={row.id}><CostStockReceiptSummary record={row}/><button disabled={busy||childBusy} onClick={()=>open("stock",row)}>이 품목 재고 원장</button><button disabled={busy||childBusy} onClick={()=>open("ppe",row)}>같은 품목으로 별도 보호구 지급</button>{row.status==="active"&&<button disabled={busy||childBusy} onClick={()=>open("reverse",row)}>입고 전량 역분개 검토</button>}</article>)}
   <button disabled={busy||childBusy||!offset} onClick={()=>{if(guard.canLeave())setOffset(Math.max(0,offset-50));}}>이전 50</button><button disabled={busy||childBusy||!context.hasMore} onClick={()=>{if(guard.canLeave())setOffset(offset+50);}}>다음 50</button>
  </>}
 </section>;
}
