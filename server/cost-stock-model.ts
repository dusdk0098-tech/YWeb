import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import { getCostPeriod,getExpense,type CostExpense,type CostSnapshot } from "./cost-model.js";
import { journalHash } from "./daily-journal-sources.js";
import { date,revision } from "./validation.js";
import { stockUnits,stockText } from "./stock-quantity.js";
export const stockUnchangedAcknowledgment=z.object({receiptId:z.uuid(),confirmStockUnchanged:z.literal(true)}).strict();
export type StockUnchangedAcknowledgment=z.infer<typeof stockUnchangedAcknowledgment>;
export const costStockCreateInput=z.object({periodVersion:revision,expenseVersion:revision,itemId:z.uuid(),itemVersion:revision,quantity:z.string().max(24),effectiveDate:date,reason:z.string().trim().min(1).max(1000),confirmSeparatePhysicalQuantity:z.literal(true)}).strict().transform(v=>({...v,quantity:stockText(stockUnits(v.quantity))}));
export const costStockReverseInput=z.object({itemVersion:revision,effectiveDate:date,reason:z.string().trim().min(1).max(1000),confirmFinanceUnchanged:z.literal(true)}).strict();
export type CostStockRow={id:string;site_id:string;period_id:string;expense_id:string;item_id:string;movement_id:string;snapshot:string;snapshot_hash:string;status:"active"|"reversed";reversal_movement_id:string|null;reversal_snapshot:string|null;reversal_hash:string|null;created_at:string};
export type CostStockSource={siteId:string;periodId:string;periodVersion:number;month:string;periodStatus:"open"|"closed";category:{id:string;label:string};expense:CostExpense;closure:{id:string;hash:string;number:number}|null};
export type CostStockSnapshot={schemaVersion:1;id:string;source:CostStockSource;item:{id:string;name:string;unit:string;version:number};physicalQuantity:string;movementId:string;movementHash:string;effectiveDate:string;reason:string;actor:{id:string;name:string};at:string};
export type CostStockReversal={receiptId:string;movementId:string;movementHash:string;effectiveDate:string;reason:string;actor:{id:string;name:string};at:string};
export function activeCostReceipt(db:Db,expenseId:string){return db.prepare("SELECT id FROM cost_stock_receipts WHERE expense_id=? AND status='active'").get(expenseId) as {id:string}|undefined;}
export function assertCostStockAcknowledgment(db:Db,expenseId:string,ack:StockUnchangedAcknowledgment|undefined){
 const active=activeCostReceipt(db,expenseId);
 if(active&&(!ack||ack.receiptId!==active.id||ack.confirmStockUnchanged!==true))throw new HttpError(409,"연결 입고가 있습니다. 해당 입고의 재고는 바꾸지 않는 비용 정정임을 명시 확인하세요.");
 if(!active&&ack)throw new HttpError(409,"연결 입고 상태가 바뀌었습니다. 현재 출처를 다시 조회하세요.");
}
export function assertNoActiveCostReceipt(db:Db,expenseId:string){if(activeCostReceipt(db,expenseId))throw new HttpError(409,"활성 연결 입고가 있어 비용행을 분할할 수 없습니다. 입고를 사실에 맞게 정리한 후 다시 확인하세요.");}
export function assertNoChildCostReceipts(db:Db,splitId:string){if(db.prepare("SELECT 1 FROM cost_split_children c JOIN cost_stock_receipts r ON r.expense_id=c.expense_id AND r.status='active' WHERE c.split_id=? LIMIT 1").get(splitId))throw new HttpError(409,"분할 자식에 활성 연결 입고가 있어 되돌릴 수 없습니다. 입고와 비용은 자동 상쇄하지 않습니다.");}
export function costStockSource(db:Db,site:string,periodId:string,expenseId:string):CostStockSource{
 const period=getCostPeriod(db,site,periodId),expense=getExpense(db,periodId,expenseId);
 if(expense.status!=="active")throw new HttpError(409,"유효 비용행만 새 입고 출처로 선택할 수 있습니다.");
 const categories=JSON.parse(period.categories) as {id:string;label:string}[],category=categories.find(c=>c.id===expense.category_id);
 if(!category)throw new HttpError(409,"비용 항목 출처가 일치하지 않습니다.");
 let closure:CostStockSource["closure"]=null;
 if(period.status==="closed"){
  const c=db.prepare("SELECT id,number,body,hash FROM cost_closures WHERE id=? AND period_id=?").get(period.current_close_id,period.id) as {id:string;number:number;body:string;hash:string}|undefined;
  if(!c)throw new HttpError(409,"현재 마감본이 없습니다.");
  const snapshot=JSON.parse(c.body) as CostSnapshot;
  if(journalHash(snapshot)!==c.hash||snapshot.id!==c.id||snapshot.period.current_close_id!==c.id||snapshot.site.id!==site||snapshot.period.id!==period.id||snapshot.period.version!==period.version||JSON.stringify(snapshot.expenses.find(e=>e.id===expense.id))!==JSON.stringify(expense))throw new HttpError(409,"마감본의 비용행 출처가 일치하지 않습니다.");
  closure={id:c.id,hash:c.hash,number:c.number};
 }
 return{siteId:site,periodId:period.id,periodVersion:period.version,month:period.month,periodStatus:period.status,category:{id:category.id,label:category.label},expense,closure};
}
export function costStockRecord(db:Db,row:CostStockRow){
 const snapshot=JSON.parse(row.snapshot) as CostStockSnapshot,reversal=row.reversal_snapshot?JSON.parse(row.reversal_snapshot) as CostStockReversal:null;
 if(journalHash(snapshot)!==row.snapshot_hash||snapshot.id!==row.id||snapshot.source.siteId!==row.site_id||snapshot.source.expense.id!==row.expense_id||snapshot.source.periodId!==row.period_id||snapshot.item.id!==row.item_id||snapshot.movementId!==row.movement_id||(row.status==="active"&&(reversal!==null||row.reversal_movement_id!==null||row.reversal_hash!==null))||(row.status==="reversed"&&(!reversal||reversal.receiptId!==row.id||reversal.movementId!==row.reversal_movement_id))||(reversal&&journalHash(reversal)!==row.reversal_hash))throw new HttpError(409,"비용 입고 출처 보관본이 일치하지 않습니다.");
 const expense=getExpense(db,row.period_id,row.expense_id),period=getCostPeriod(db,row.site_id,row.period_id);
 return{...row,snapshot,reversal,currentSource:{expenseVersion:expense.version,status:expense.status,periodStatus:period.status,description:expense.description,categoryId:expense.category_id,quantity:expense.quantity,unitPriceWon:expense.unit_price_won,amount:expense.amount,changed:expense.version!==snapshot.source.expense.version||JSON.stringify(expense)!==JSON.stringify(snapshot.source.expense)}};
}
export type CostStockRecord=ReturnType<typeof costStockRecord>;
