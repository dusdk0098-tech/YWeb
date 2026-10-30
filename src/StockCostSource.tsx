import {useEffect,useState} from "react";
import {api} from "./api";
import type {CostStockRecord} from "../server/cost-stock-model";
import {CostStockReceiptSummary} from "./CostStockReceiptForm";
export function StockCostSource({siteId,receiptId,disabled}:{siteId:string;receiptId:string;disabled:boolean}){
 const [opened,setOpened]=useState(false),[result,setResult]=useState<{key:string;record:CostStockRecord}|null>(null),[error,setError]=useState(""),key=`${siteId}:${receiptId}`;
 useEffect(()=>{if(!opened)return;let active=true;setError("");api<CostStockRecord>(`/sites/${siteId}/cost-stock-receipts/${receiptId}`).then(record=>{if(active)setResult({key,record});}).catch((e:Error)=>{if(active)setError(e.message);});return()=>{active=false;};},[opened,siteId,receiptId,key]);
 return <section><p>비용 연결 입고 {receiptId}. 일반 역분개 대신 해당 비용행의 연결 입고 화면을 사용하세요. 비용은 자동 취소되지 않습니다.</p><button type="button" disabled={disabled} onClick={()=>{setResult(null);setOpened(!opened);}}>{opened?"비용 출처 닫기":"당시 비용 출처 / 현재 차이 조회"}</button>{opened&&(result?.key===key?<><p>비용 원장 {result.record.period_id} / 비용행 {result.record.expense_id}</p><CostStockReceiptSummary record={result.record}/></>:<p>{error||"현재 권한으로 출처 조회 중…"}</p>)}</section>;
}
