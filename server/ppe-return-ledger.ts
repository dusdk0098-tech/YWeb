import { createHash } from "node:crypto";
import { HttpError } from "./site-operations.js";
import { stockUnits, stockText } from "./stock-quantity.js";
import type { Db } from "./db.js";
import type { StockMovement } from "./stock-model.js";
export const MAX_PARTIAL_RETURNS = 3;
export const MAX_STOCK_MOVEMENTS_WITH_PPE = 9000;
export type ReturnKind = "partial" | "cancel" | "terminal";
export type ReturnSnapshot = {
  id: string; issueId: string; sourceHash: string; movementId: string;
  kind: ReturnKind; quantity: string; cancelsId: string | null;
  effectiveDate: string; reason: string; actor: {id:string;name:string}; at: string;
};
export type ReturnRow = {id:string;issue_id:string;item_id:string;movement_id:string;kind:ReturnKind;cancels_id:string|null;snapshot:string;snapshot_hash:string};
export const returnHash=(s:string)=>createHash("sha256").update(s).digest("hex");
const bad=()=>{throw new HttpError(409,"보호구 반납 출처/수량/순서/예약 용량이 일치하지 않습니다.");};
export function validateReturnEntries(issued:string, entries:ReturnSnapshot[]) {
 const original=stockUnits(issued); let returned=0n, partialCount=0, terminal=false;
 const partials=new Map<string,ReturnSnapshot>(), cancelled=new Set<string>(), ids=new Set<string>();
 for(const r of entries){
  if(ids.has(r.id)||terminal)bad(); ids.add(r.id);
  const n=stockUnits(r.quantity);
  if(r.kind==="cancel"){
   const target=partials.get(r.cancelsId||"");
   if(!target||cancelled.has(target.id)||target.quantity!==r.quantity)bad();
   cancelled.add(target!.id); returned-=n;
  }else{
   if(r.cancelsId!==null||n>original-returned)bad();
   if(r.kind==="partial"){
    if(n>=original-returned||++partialCount>MAX_PARTIAL_RETURNS)bad();
    partials.set(r.id,r);
   }else if(r.kind==="terminal"){
    if(n!==original-returned)bad(); terminal=true;
   }else bad();
   returned+=n;
  }
  if(returned<0n||returned>original)bad();
 }
 return {returnedQuantity:stockText(returned),remainingQuantity:stockText(original-returned),partialCount,terminal,cancelled};
}
export function ppeReturnQuota(db:Db,itemId:string,movements:StockMovement[]) {
 const rows=db.prepare("SELECT r.* FROM ppe_return_entries r JOIN stock_movements m ON m.id=r.movement_id WHERE r.item_id=? ORDER BY m.sequence").all(itemId) as ReturnRow[];
 const movementMap=new Map(movements.map(m=>[m.id,m]));
 const rowMap=new Map(rows.map(r=>[r.id,r]));
 const reversedTargets=new Set(movements.filter(m=>m.reverses_id!==null).map(m=>m.reverses_id));
 const linked=new Set<string>(); const grouped=new Map<string,ReturnSnapshot[]>();
 for(const row of rows){
  if(returnHash(row.snapshot)!==row.snapshot_hash)bad();
  const s=JSON.parse(row.snapshot) as ReturnSnapshot,m=movementMap.get(row.movement_id);
  if(s.id!==row.id||s.issueId!==row.issue_id||s.movementId!==row.movement_id||s.kind!==row.kind||s.cancelsId!==row.cancels_id||!m||linked.has(m.id)||s.quantity!==m.quantity||s.effectiveDate!==m.effective_date||s.actor.id!==m.actor_id||s.actor.name!==m.actor_name||s.at!==m.recorded_at||s.reason!==m.reason)bad();
  if(row.kind==="cancel"){
   const target=rowMap.get(row.cancels_id||"");
   if(!target||target.issue_id!==row.issue_id||target.kind!=="partial"||m!.kind!=="reversal"||m!.direction!==-1||m!.reverses_id!==target.movement_id)bad();
  }else if(m!.kind!=="adjust_in"||m!.direction!==1||m!.reverses_id!==null)bad();
  linked.add(m!.id);
  const list=grouped.get(row.issue_id)||[];list.push(s);grouped.set(row.issue_id,list);
 }
 for(const movement of movements){if(movement.reverses_id&&linked.has(movement.reverses_id)&&!linked.has(movement.id))bad();}
 for(const [id,entries] of grouped){
  const source=db.prepare("SELECT * FROM ppe_issues WHERE id=? AND item_id=?").get(id,itemId) as {original:string;original_hash:string;issue_movement_id:string;site_id:string;worker_id:string;return_movement_id:string|null}|undefined;
  if(!source||returnHash(source.original)!==source.original_hash||source.return_movement_id!==null)bad();
  const original=JSON.parse(source!.original) as {id:string;quantity:string;item:{id:string};site:{id:string};worker:{id:string};issueMovementId:string};
  const issue=movementMap.get(source!.issue_movement_id);
  if(original.id!==id||original.item.id!==itemId||original.site.id!==source!.site_id||original.worker.id!==source!.worker_id||original.issueMovementId!==source!.issue_movement_id||!issue||issue.kind!=="issue"||issue.quantity!==original.quantity||reversedTargets.has(issue.id)||entries.some(e=>e.sourceHash!==source!.original_hash||movementMap.get(e.movementId)!.sequence<=issue.sequence))bad();
  validateReturnEntries(original.quantity,entries);
 }
 const originalCount=movements.filter(m=>m.kind!=="reversal"&&!linked.has(m.id)).length;
 const reversalCount=movements.filter(m=>m.kind==="reversal"&&!linked.has(m.id)).length;
 if(originalCount>1000||reversalCount>1000||linked.size>7000||movements.length>MAX_STOCK_MOVEMENTS_WITH_PPE)bad();
 return {originalCount,reversalCount,ppeReturnMovementCount:linked.size,linked,returnRows:rows};
}
