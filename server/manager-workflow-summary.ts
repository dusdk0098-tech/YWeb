import type { Db } from "./db.js";
import { buildRiskOverview } from "./risk-overview.js";
import { costExpenses, costTotals, type CostCategory, type CostPeriodRow, type CostSnapshot } from "./cost-model.js";
import { journalHash } from "./daily-journal-sources.js";
type Section<T>={status:"available";value:T}|{status:"unavailable"};
function section<T>(read:()=>T):Section<T>{try{return {status:"available",value:read()};}catch{return {status:"unavailable"};}}
export type DueCounts={beforeDate:number;onDate:number;afterDate:number};
function due(){return {beforeDate:0,onDate:0,afterDate:0};}
// Runs within the manager overview read transaction after current membership filtering.
export function managerWorkflowSummary(db:Db,site:string,asOfDate:string) {
 const risk=section(()=>{const value=buildRiskOverview(db,site,{asOfDate});return {groups:value.groups};});
 const documents=section(()=>{
  const plans={currentLeaf:0,priorWithSuccessor:0};
  const planRows=db.prepare("SELECT EXISTS(SELECT 1 FROM work_plans child WHERE child.parent_id=p.id AND child.site_id=p.site_id) successor,count(*) n FROM work_plan_document_reviews r JOIN work_plans p ON p.id=r.plan_id WHERE p.site_id=? AND r.status='submitted' GROUP BY successor").all(site) as {successor:number;n:number}[];
  for(const r of planRows)plans[r.successor?"priorWithSuccessor":"currentLeaf"]=r.n;
  const inspections={currentLeaf:{draft:0,submitted:0,accepted:0,returned:0},priorWithSuccessor:{draft:0,submitted:0,accepted:0,returned:0}};
  const rows=db.prepare("SELECT i.status,EXISTS(SELECT 1 FROM inspections child WHERE child.parent_id=i.id AND child.site_id=i.site_id) successor,count(*) n FROM inspections i WHERE i.site_id=? GROUP BY i.status,successor").all(site) as {status:string;successor:number;n:number}[];
  for(const r of rows){if(!["draft","submitted","accepted","returned"].includes(r.status))throw Error("invalid");inspections[r.successor?"priorWithSuccessor":"currentLeaf"][r.status as "draft"|"submitted"|"accepted"|"returned"]=r.n;}
  return {workPlansSubmitted:plans,inspections};
 });
 const meetingFollowups=section(()=>{
  const counts={current:{assigned:due(),reported:due(),verified:due()},priorWithCorrection:{assigned:due(),reported:due(),verified:due()}};
  const rows=db.prepare(`SELECT f.status,EXISTS(SELECT 1 FROM minutes_records r WHERE r.parent_id=f.minutes_id) successor,
   CASE WHEN length(f.due)!=10 OR f.due NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' OR date(f.due,'+0 days') IS NULL OR date(f.due,'+0 days')!=f.due THEN 'invalid'
   WHEN f.due<? THEN 'beforeDate' WHEN f.due=? THEN 'onDate' ELSE 'afterDate' END bucket,count(*) n FROM minutes_followups f JOIN minutes m ON m.id=f.minutes_id AND m.site_id=f.site_id WHERE f.site_id=? GROUP BY f.status,successor,bucket`).all(asOfDate,asOfDate,site) as {status:string;successor:number;bucket:string;n:number}[];
  for(const r of rows){if(!["assigned","reported","verified"].includes(r.status)||!["beforeDate","onDate","afterDate"].includes(r.bucket))throw Error("invalid");counts[r.successor?"priorWithCorrection":"current"][r.status as "assigned"|"reported"|"verified"][r.bucket as keyof DueCounts]=r.n;}
  return counts;
 });
 return {risk,documents,meetingFollowups};
}
export function managerCostSummary(db:Db,site:string,month:string) {
 return section(()=>{
  const row=db.prepare("SELECT * FROM cost_periods WHERE site_id=? AND month=?").get(site,month) as CostPeriodRow|undefined;
  if(!row)return {kind:"no_period" as const,month};
  if(!["open","closed"].includes(row.status))throw Error("invalid");
  const categories=JSON.parse(row.categories) as CostCategory[];
  if(!Array.isArray(categories)||categories.length<1||categories.length>20||new Set(categories.map(c=>c.id)).size!==categories.length)throw Error("invalid");
  const expenses=costExpenses(db,row.id);
  if(expenses.some(e=>e.status!=="active"&&e.status!=="cancelled"))throw Error("invalid");
  const totals=costTotals(categories,expenses);
  let closure:{id:string;hash:string;closedAt:string}|null=null;
  if(row.status==="closed") {
   const stored=db.prepare("SELECT body,hash FROM cost_closures WHERE id=? AND period_id=?").get(row.current_close_id,row.id) as {body:string;hash:string}|undefined;
   if(!stored||Buffer.byteLength(stored.body)>4*1024*1024)throw Error("invalid");
   const s=JSON.parse(stored.body) as CostSnapshot;
   if(s.schema!==1||s.id!==row.current_close_id||s.site.id!==site||s.period.id!==row.id||s.period.month!==month||s.policy!=="exact-six-decimal-whole-won-price-v1"||journalHash(s)!==stored.hash||JSON.stringify(s.period)!==JSON.stringify({...row,categories})||JSON.stringify(s.totals)!==JSON.stringify(totals)||JSON.stringify(s.expenses)!==JSON.stringify(expenses))throw Error("invalid");
   closure={id:s.id,hash:stored.hash,closedAt:s.closedAt};
  } else if(row.current_close_id!==null)throw Error("invalid");
  return {kind:"period" as const,month,id:row.id,version:row.version,state:row.status,currency:"KRW" as const,precision:6 as const,totals:totals.total,closure};
 });
}
