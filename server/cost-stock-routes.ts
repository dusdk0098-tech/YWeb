import type { Express,Request } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit,type Db } from "./db.js";
import { HttpError,type SiteOperations } from "./site-operations.js";
import { companyPage } from "./companies.js";
import { getCostPeriod,getExpense } from "./cost-model.js";
import { stockItem,stockState } from "./stock-model.js";
import { stockWriter } from "./stock-write.js";
import { account } from "./inspection-model.js";
import { journalHash } from "./daily-journal-sources.js";
import { activeCostReceipt,costStockSource,costStockRecord,costStockCreateInput,costStockReverseInput,type CostStockRow,type CostStockSnapshot,type CostStockReversal } from "./cost-stock-model.js";
export function registerCostStock(app:Express,db:Db,{access,mutate}:SiteOperations){
 const expenseBase="/api/sites/:siteId/cost-periods/:id/expenses/:expenseId/stock-receipts",base="/api/sites/:siteId/cost-stock-receipts",{append}=stockWriter(db);
 function read(req:Request){const row=db.prepare("SELECT * FROM cost_stock_receipts WHERE site_id=? AND id=?").get(String(req.params.siteId),String(req.params.receiptId)) as CostStockRow|undefined;if(!row)throw new HttpError(404,"비용 연결 입고를 찾을 수 없습니다.");return row;}
 app.get(expenseBase,(req,res)=>{access(req,true,true);const q=companyPage.parse(req.query),site=String(req.params.siteId),period=getCostPeriod(db,site,String(req.params.id)),expense=getExpense(db,period.id,String(req.params.expenseId));
  const rows=db.prepare("SELECT * FROM cost_stock_receipts WHERE site_id=? AND expense_id=? ORDER BY created_at DESC,id LIMIT 51 OFFSET ?").all(site,expense.id,q.offset) as CostStockRow[];
  res.json({periodVersion:period.version,periodStatus:period.status,expense,activeReceiptId:activeCostReceipt(db,expense.id)?.id??null,items:rows.slice(0,50).map(row=>costStockRecord(db,row)),hasMore:rows.length>50});
 });
 app.get(base+"/:receiptId",(req,res)=>{access(req,true,true);z.object({}).strict().parse(req.query);res.json(costStockRecord(db,read(req)));});
 app.post(expenseBase,(req,res)=>{access(req,true,true);const v=costStockCreateInput.parse(req.body),site=String(req.params.siteId),periodId=String(req.params.id),expenseId=String(req.params.expenseId);
  mutate(req,res,`cost-stock:create:${site}:${periodId}:${expenseId}`,v,()=>{
   const source=costStockSource(db,site,periodId,expenseId);
   if(source.periodVersion!==v.periodVersion||source.expense.version!==v.expenseVersion)throw new HttpError(409,"비용 원장/행 버전이 바뀌었습니다.");
   if(activeCostReceipt(db,expenseId))throw new HttpError(409,"이미 활성 연결 입고가 있습니다. 기존 기록을 조회하세요.");
   const item=stockItem(db,site,v.itemId);if(item.version!==v.itemVersion)throw new HttpError(409,"품목 버전이 바뀌었습니다.");
   const id=randomUUID(),at=new Date().toISOString(),result=append(req,item,{effectiveDate:v.effectiveDate,reason:`비용 연결 입고 ${id}: ${v.reason}`},"receipt",v.quantity,1,null);
   const snapshot:CostStockSnapshot={schemaVersion:1,id,source,item:{id:item.id,name:item.name,unit:item.unit,version:item.version},physicalQuantity:v.quantity,movementId:result.movement.id,movementHash:result.movement.hash,effectiveDate:v.effectiveDate,reason:v.reason,actor:account(db,req.session.userId!),at};
   db.prepare("INSERT INTO cost_stock_receipts(id,site_id,period_id,expense_id,item_id,movement_id,snapshot,snapshot_hash,status,created_at) VALUES(?,?,?,?,?,?,?,?,'active',?)").run(id,site,periodId,expenseId,item.id,result.movement.id,JSON.stringify(snapshot),journalHash(snapshot),at);
   audit(db,req.session.userId!,site,"cost_stock.received",id);
   const row=db.prepare("SELECT * FROM cost_stock_receipts WHERE id=?").get(id) as CostStockRow;
   return{receipt:costStockRecord(db,row),item:result.item};
  },()=>{access(req,true,true);});
 });
 app.post(base+"/:receiptId/reverse",(req,res)=>{access(req,true,true);const v=costStockReverseInput.parse(req.body),site=String(req.params.siteId),id=String(req.params.receiptId);
  mutate(req,res,`cost-stock:reverse:${site}:${id}`,v,()=>{
   const row=read(req);costStockRecord(db,row);
   if(row.status!=="active")throw new HttpError(409,"이미 전량 역분개된 연결 입고입니다.");
   const item=stockItem(db,site,row.item_id);if(item.version!==v.itemVersion)throw new HttpError(409,"품목 버전이 바뀌었습니다.");
   const state=stockState(db,item),original=state.rows.find(m=>m.id===row.movement_id);
   if(!original||original.kind!=="receipt"||state.reversed.has(original.id))throw new HttpError(409,"원 입고/역분개 상태가 일치하지 않습니다.");
   const result=append(req,item,{effectiveDate:v.effectiveDate,reason:`비용 연결 입고 전량 역분개 ${id}: ${v.reason}`},"reversal",original.quantity,-1,original.id);
   const reversal:CostStockReversal={receiptId:id,movementId:result.movement.id,movementHash:result.movement.hash,effectiveDate:v.effectiveDate,reason:v.reason,actor:account(db,req.session.userId!),at:new Date().toISOString()};
   db.prepare("UPDATE cost_stock_receipts SET status='reversed',reversal_movement_id=?,reversal_snapshot=?,reversal_hash=? WHERE id=?").run(result.movement.id,JSON.stringify(reversal),journalHash(reversal),id);
   audit(db,req.session.userId!,site,"cost_stock.reversed",id);
   return{receipt:costStockRecord(db,read(req)),item:result.item};
  },()=>{access(req,true,true);});
 });
}
