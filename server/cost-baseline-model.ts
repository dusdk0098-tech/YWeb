import { z } from "zod";
import type { Db } from "./db.js";
import { date, revision } from "./validation.js";
import { HttpError } from "./site-operations.js";
import { journalHash } from "./daily-journal-sources.js";
import { costExpenses, costTotals, getCostPeriod, type CostSnapshot, type CostCategory, type CostExpense } from "./cost-model.js";
import { splitView, type SplitRow } from "./cost-split-model.js";
import { moneyUnits, decimalText } from "./cost-money.js";
export const baselineCreate = z.object({version:revision,closureId:z.uuid(),closureHash:z.string().regex(/^[a-f0-9]{64}$/),memo:z.string().trim().min(1).max(1000)}).strict();
export const statementCreate = z.object({baselineHash:z.string().regex(/^[a-f0-9]{64}$/),submittedDate:date,memo:z.string().trim().min(1).max(1000),correctsId:z.uuid().nullable(),confirmHumanStatement:z.literal(true)}).strict();
export type SplitFact = {id:string;sourceExpenseId:string;children:string[];hash:string;status:"active"|"undone";undoHash:string|null};
export type CostBaseline = {schema:1;id:string;closureId:string;closureHash:string;closure:CostSnapshot;splits:SplitFact[];createdBy:{id:string;name:string};createdAt:string;memo:string};
export type BaselineRow = {id:string;period_id:string;closure_id:string;body:string;hash:string;created_at:string};
export type Statement = {schema:1;id:string;baselineId:string;baselineHash:string;number:number;submittedDate:string;memo:string;correctsId:string|null;actor:{id:string;name:string};recordedAt:string;kind:"human-stated-submission"};
function boundedUnique(ids:string[], cap:number) { if(ids.length>cap || new Set(ids).size!==ids.length) throw new HttpError(409,"비교 자료 중복 또는 처리 한도 초과"); }
export function splitFacts(db:Db, periodId:string, site:string):SplitFact[] {
  const rows=db.prepare("SELECT * FROM cost_splits WHERE period_id=? ORDER BY id LIMIT 1001").all(periodId) as SplitRow[];
  boundedUnique(rows.map(r=>r.id),1000);
  return rows.map(row=>{
    const view=splitView(row,site);
    const children=(db.prepare("SELECT expense_id FROM cost_split_children WHERE split_id=? ORDER BY expense_id LIMIT 21").all(row.id) as {expense_id:string}[]).map(r=>r.expense_id);
    if(children.length<2 || children.length>20 || JSON.stringify(children)!==JSON.stringify(view.snapshot.children.map(c=>c.id).sort()) || (row.status==='undone')!==Boolean(view.undo)) throw new HttpError(409,"분할 계보 불일치");
    return {id:row.id,sourceExpenseId:row.source_expense_id,children,hash:row.hash,status:row.status,undoHash:row.undo_hash};
  });
}
function checkedTotals(categories:CostCategory[], expenses:CostExpense[], periodId:string) {
  boundedUnique(categories.map(c=>c.id),20); boundedUnique(expenses.map(e=>e.id),1000);
  if(!categories.length || expenses.some(e=>e.period_id!==periodId || !['active','cancelled'].includes(e.status))) throw new HttpError(409,"비용 비교 출처 불일치");
  return costTotals(categories,expenses);
}
export function baselineView(db:Db,site:string,periodId:string,id:string) {
  getCostPeriod(db,site,periodId);
  const row=db.prepare("SELECT * FROM cost_baselines WHERE id=? AND period_id=?").get(id,periodId) as BaselineRow|undefined;
  if(!row) throw new HttpError(404,"비용 기준본을 찾을 수 없습니다.");
  const body=JSON.parse(row.body) as CostBaseline;
  const source=db.prepare("SELECT body,hash FROM cost_closures WHERE id=? AND period_id=?").get(row.closure_id,periodId) as {body:string;hash:string}|undefined;
  if(body.schema!==1 || body.id!==id || body.closureId!==row.closure_id || body.closure.period.id!==periodId || body.closure.site.id!==site || journalHash(body)!==row.hash || !source || source.hash!==body.closureHash || source.body!==JSON.stringify(body.closure) || journalHash(body.closure)!==body.closureHash) throw new HttpError(409,"기준본 또는 마감 출처/해시 불일치");
  if(JSON.stringify(checkedTotals(body.closure.period.categories,body.closure.expenses,periodId))!==JSON.stringify(body.closure.totals)) throw new HttpError(409,"마감 합계 불일치");
  return {id:row.id,hash:row.hash,body};
}
export function currentBaselineSource(db:Db,site:string,periodId:string) {
  const period=getCostPeriod(db,site,periodId),categories=JSON.parse(period.categories) as CostCategory[],expenses=costExpenses(db,periodId);
  const totals=checkedTotals(categories,expenses,periodId),splits=splitFacts(db,periodId,site);
  const ids=new Set(expenses.map(e=>e.id));
  if(splits.some(s=>!ids.has(s.sourceExpenseId)||s.children.some(id=>!ids.has(id)))) throw new HttpError(409,"분할 출처 행 누락");
  return {period:{...period,categories},expenses,totals,splits};
}
export type Change = {kind:"period"|"category"|"expense"|"split"|"totals";id:string;field:string;before:unknown;after:unknown;delta?:string};
function signedUnits(s:string):bigint { return s.startsWith('-') ? -moneyUnits(s.slice(1)):moneyUnits(s); }
export function compareCostBaseline(b:CostBaseline,c:ReturnType<typeof currentBaselineSource>) {
  const changes:Change[]=[];
  const add=(kind:Change['kind'],id:string,field:string,before:unknown,after:unknown,money=false)=>{
    if(money && typeof before==='string' && typeof after==='string') {
      const delta=signedUnits(after)-signedUnits(before);
      if(delta!==0n) changes.push({kind,id,field,before,after,delta:decimalText(delta)});
    } else if(JSON.stringify(before)!==JSON.stringify(after)) changes.push({kind,id,field,before,after});
  };
  if(b.closure.period.id!==c.period.id || b.closure.period.month!==c.period.month || b.closure.site.id!==c.period.site_id) throw new HttpError(409,"동일 현장/월/원장이 아닙니다.");
  for (const [before,after] of [[b.closure.expenses,c.expenses],[b.closure.period.categories,c.period.categories],[b.splits,c.splits]] as const) {
    const ids=new Set(after.map(r=>r.id));
    if(before.some(r=>!ids.has(r.id))) throw new HttpError(409,'보존되어야 할 기준 행/항목/계보가 현재 자료에서 누락되었습니다.');
  }
  for(const field of ['status','version','current_close_id','parent_period_id','source_close_id','opening_note'] as const) add('period',c.period.id,field,b.closure.period[field],c.period[field]);
  function rows(kind:Change['kind'],before:Record<string,unknown>[],after:Record<string,unknown>[],fields:string[],moneyFields:string[]) {
    const left=new Map(before.map(r=>[String(r.id),r])),right=new Map(after.map(r=>[String(r.id),r]));
    for(const id of [...new Set([...left.keys(),...right.keys()])].sort()) {
      const a=left.get(id),z=right.get(id);
      if(!a||!z) {add(kind,id,!a?'added':'missing',a??null,z??null);continue;}
      for(const field of fields) add(kind,id,field,a[field],z[field],moneyFields.includes(field));
    }
  }
  rows('category',b.closure.period.categories,c.period.categories,['label','plan','opening'],['plan','opening']);
  rows('totals',b.closure.totals.byCategory,c.totals.byCategory,['current','cumulative','remaining'],['current','cumulative','remaining']);
  rows('expense',b.closure.expenses,c.expenses,['category_id','spend_date','description','quantity','unit_price_won','amount','status','version'],['quantity','unit_price_won','amount']);
  rows('split',b.splits,c.splits,['sourceExpenseId','children','hash','status','undoHash'],[]);
  for(const field of ['plan','opening','current','cumulative','remaining'] as const) add('totals',c.period.id,field,b.closure.totals.total[field],c.totals.total[field],true);
  return {available:true as const,asOf:new Date().toISOString(),baselineId:b.id,baselineClosureId:b.closureId,currentVersion:c.period.version,currentStatus:c.period.status,changed:changes.length>0,changes};
}
export function costBaselineComparison(db:Db,site:string,period:string,id:string) {
  // Caller owns one read transaction; authorization/not-found are not converted to a success.
  const baseline=baselineView(db,site,period,id);
  try { return compareCostBaseline(baseline.body,currentBaselineSource(db,site,period)); }
  catch {return {available:false as const,asOf:new Date().toISOString(),baselineId:id,reason:"현재 비교 자료를 검증할 수 없습니다. 누락·한도·계보/금액 오류를 확인하세요."};}
}
