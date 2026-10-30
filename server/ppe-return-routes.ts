import type { Express, Request } from "express";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { date, revision } from "./validation.js";
import { account } from "./inspection-model.js";
import { ppeRecord, type PpeRow } from "./ppe.js";
import { stockItem, stockState } from "./stock-model.js";
import { stockWriter } from "./stock-write.js";
import { stockUnits, stockText } from "./stock-quantity.js";
import { validateReturnEntries, type ReturnSnapshot } from "./ppe-return-ledger.js";
const common={version:revision,itemVersion:revision,effectiveDate:date,reason:z.string().trim().min(1).max(1000)};
export const ppePartialInput=z.object({...common,kind:z.enum(["partial","terminal"]),quantity:z.string().max(24),confirmBoundedPolicy:z.literal(true)}).strict();
const cancelInput=z.object({...common,confirmCancelWholeEntry:z.literal(true)}).strict();
export function registerPpeReturns(app:Express,db:Db,{access,mutate}:SiteOperations){
 const base="/api/sites/:siteId/ppe-issues/:id/returns",{append}=stockWriter(db);
 function row(req:Request){const r=db.prepare("SELECT * FROM ppe_issues WHERE site_id=? AND id=?").get(String(req.params.siteId),String(req.params.id)) as PpeRow|undefined;if(!r)throw new HttpError(404,"보호구 지급을 찾을 수 없습니다.");return r;}
 function view(r:PpeRow){
  const source=ppeRecord(r),state=stockState(db,stockItem(db,r.site_id,r.item_id));
  const entries=state.returnRows.filter(e=>e.issue_id===r.id).map(e=>JSON.parse(e.snapshot) as ReturnSnapshot);
  const total=validateReturnEntries(source.original.quantity,entries);
  return {issue:source,entries,summary:{returnedQuantity:r.return_movement_id?source.original.quantity:total.returnedQuantity,remainingQuantity:r.return_movement_id?"0":total.remainingQuantity,partialCount:total.partialCount,terminal:!!r.return_movement_id||total.terminal,partialLimit:3},itemVersion:stockItem(db,r.site_id,r.item_id).version};
 }
 function finish(req:Request,prior:PpeRow,terminal:boolean,event:string,reason:string){
  const at=new Date().toISOString();
  db.prepare("UPDATE ppe_issues SET status=?,version=version+1,updated_at=? WHERE id=?").run(terminal?"returned":"issued",at,prior.id);
  const next=view(row(req)),actor=account(db,req.session.userId!);
  db.prepare("INSERT INTO ppe_events(issue_id,version,event,actor_id,actor_name,at,reason,snapshot) VALUES(?,?,?,?,?,?,?,?)").run(prior.id,next.issue.version,event,actor.id,actor.name,at,reason,JSON.stringify(next));
  audit(db,actor.id,prior.site_id,"ppe."+event,prior.id);return next;
 }
 app.get(base,(req,res)=>{access(req,true,true);res.json(view(row(req)));});
 app.post(base,(req,res)=>{
  access(req,true,true);const input=ppePartialInput.parse(req.body),v={...input,quantity:stockText(stockUnits(input.quantity))};
  mutate(req,res,`ppe:partial-return:${req.params.siteId}:${req.params.id}`,v,()=>{
   const r=row(req),item=stockItem(db,r.site_id,r.item_id);
   if(r.version!==v.version||item.version!==v.itemVersion)throw new HttpError(409,"지급/품목 버전이 바뀌었습니다.");
   append(req,item,{effectiveDate:v.effectiveDate,reason:`PPE ${v.kind} 반납 ${r.id} · ${v.reason}`},"adjust_in",v.quantity,1,null,{issueId:r.id,kind:v.kind,cancelsId:null});
   return finish(req,r,v.kind==="terminal",v.kind==="terminal"?"remaining_return_recorded":"partial_return_recorded",v.reason);
  },()=>{access(req,true,true);row(req);});
 });
 app.post(base+"/:returnId/cancel",(req,res)=>{
  access(req,true,true);const v=cancelInput.parse(req.body);
  mutate(req,res,`ppe:partial-cancel:${req.params.siteId}:${req.params.id}:${req.params.returnId}`,v,()=>{
   const r=row(req),item=stockItem(db,r.site_id,r.item_id);
   if(r.version!==v.version||item.version!==v.itemVersion)throw new HttpError(409,"지급/품목 버전이 바뀌었습니다.");
   const current=view(r),target=current.entries.find(e=>e.id===req.params.returnId&&e.kind==="partial");
   if(!target)throw new HttpError(404,"취소할 부분 반납을 찾을 수 없습니다.");
   append(req,item,{effectiveDate:v.effectiveDate,reason:`PPE 부분 반납 오류취소 ${target.id} · ${v.reason}`},"reversal",target.quantity,-1,target.movementId,{issueId:r.id,kind:"cancel",cancelsId:target.id});
   return finish(req,r,false,"partial_return_cancelled",v.reason);
  },()=>{access(req,true,true);row(req);});
 });
}
