import type { Express } from "express";
import { randomUUID } from "node:crypto";
import type { Db } from "./db.js";
import type { SiteOperations } from "./site-operations.js";
import { HttpError } from "./site-operations.js";
import { account } from "./inspection-model.js";
import { inspectionPage } from "./inspection-validation.js";
import { journalHash } from "./daily-journal-sources.js";
import { getCostPeriod, type CostSnapshot } from "./cost-model.js";
import { baselineCreate, statementCreate, baselineView, currentBaselineSource, costBaselineComparison, type CostBaseline, type Statement } from "./cost-baseline-model.js";
import { printCostBaseline, printCostStatement } from "./cost-baseline-print.js";
export function registerCostBaselines(app:Express,db:Db,{access,mutate}:SiteOperations) {
  const base='/api/sites/:siteId/cost-periods/:id/baselines';
  function read<T>(fn:()=>T):T { db.exec('BEGIN');try {const result=fn();db.exec('COMMIT');return result;} catch(error) {db.exec('ROLLBACK');throw error;} }
  app.get(base,(req,res)=>{
    access(req,true,true);const period=getCostPeriod(db,String(req.params.siteId),String(req.params.id)),q=inspectionPage.parse(req.query);
    const rows=db.prepare('SELECT id,closure_id,hash,created_at FROM cost_baselines WHERE period_id=? ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET ?').all(period.id,q.offset);
    res.json({items:rows.slice(0,50),hasMore:rows.length>50});
  });
  app.post(base,(req,res)=>{
    access(req,true,true);const v=baselineCreate.parse(req.body),site=String(req.params.siteId),period=String(req.params.id);
    mutate(req,res,`cost:baseline:${site}:${period}`,v,()=>{
      const current=currentBaselineSource(db,site,period),row=current.period;
      if(row.status!=='closed'||row.version!==v.version||row.current_close_id!==v.closureId) throw new HttpError(409,'현재 마감본/원장 버전을 다시 확인하세요. 과거 마감본을 새 기준본으로 추정하지 않습니다.');
      const stored=db.prepare('SELECT body,hash FROM cost_closures WHERE id=? AND period_id=?').get(v.closureId,period) as {body:string;hash:string}|undefined;
      if(!stored || stored.hash!==v.closureHash) throw new HttpError(409,'마감본 해시 불일치');
      const closure=JSON.parse(stored.body) as CostSnapshot;
      if(journalHash(closure)!==stored.hash || closure.id!==v.closureId || closure.site.id!==site || JSON.stringify(closure.period)!==JSON.stringify(current.period) || JSON.stringify(closure.expenses)!==JSON.stringify(current.expenses) || JSON.stringify(closure.totals)!==JSON.stringify(current.totals)) throw new HttpError(409,'마감 원문과 현재 비용 자료가 일치하지 않습니다.');
      if(db.prepare('SELECT id FROM cost_baselines WHERE closure_id=?').get(v.closureId)) throw new HttpError(409,'이 마감본의 기준본이 이미 있습니다. 기존 기준본을 사용하세요.');
      const id=randomUUID(),now=new Date().toISOString();
      const body:CostBaseline={schema:1,id,closureId:v.closureId,closureHash:v.closureHash,closure,splits:current.splits,createdBy:account(db,req.session.userId!),createdAt:now,memo:v.memo};
      const serialized=JSON.stringify(body); if(Buffer.byteLength(serialized)>4*1024*1024) throw new HttpError(409,'기준본 처리 한도 4MiB 초과');
      db.prepare('INSERT INTO cost_baselines VALUES(?,?,?,?,?,?)').run(id,period,v.closureId,serialized,journalHash(body),now);
      return baselineView(db,site,period,id);
    },()=>{access(req,true,true);});
  });
  app.get(base+'/:baselineId',(req,res)=>{
    access(req,true,true);res.json(read(()=>baselineView(db,String(req.params.siteId),String(req.params.id),String(req.params.baselineId))));
  });
  app.get(base+'/:baselineId/compare',(req,res)=>{
    access(req,true,true);res.json(read(()=>costBaselineComparison(db,String(req.params.siteId),String(req.params.id),String(req.params.baselineId))));
  });
  app.get(base+'/:baselineId/export',(req,res)=>{
    access(req,true,true);const result=read(()=>baselineView(db,String(req.params.siteId),String(req.params.id),String(req.params.baselineId)));
    res.set('Content-Disposition',`attachment; filename="cost-baseline-${result.id}.json"`).type('json').send(JSON.stringify(result,null,2));
  });
  app.get(base+'/:baselineId/print',(req,res)=>{
    access(req,true,true);const result=read(()=>baselineView(db,String(req.params.siteId),String(req.params.id),String(req.params.baselineId)));
    res.type('html').send(printCostBaseline(result.body,result.hash));
  });
  app.get(base+'/:baselineId/statements',(req,res)=>{
    access(req,true,true);const q=inspectionPage.parse(req.query);
    res.json(read(()=>{
      const b=baselineView(db,String(req.params.siteId),String(req.params.id),String(req.params.baselineId));
      const rows=db.prepare('SELECT body,hash FROM cost_baseline_statements WHERE baseline_id=? ORDER BY number DESC LIMIT 51 OFFSET ?').all(b.id,q.offset) as {body:string;hash:string}[];
      return {items:rows.slice(0,50).map(row=>{const body=JSON.parse(row.body) as Statement;if(journalHash(body)!==row.hash||body.baselineHash!==b.hash) throw new HttpError(409,'제출 진술 기록 해시 불일치');return {body,hash:row.hash};}),hasMore:rows.length>50};
    }));
  });
  app.post(base+'/:baselineId/statements',(req,res)=>{
    access(req,true,true);const v=statementCreate.parse(req.body),site=String(req.params.siteId),period=String(req.params.id),id=String(req.params.baselineId);
    mutate(req,res,`cost:baseline-statement:${site}:${period}:${id}`,v,()=>{
      const b=baselineView(db,site,period,id);
      if(b.hash!==v.baselineHash) throw new HttpError(409,'기준본 해시 불일치');
      if(v.correctsId && !db.prepare('SELECT id FROM cost_baseline_statements WHERE id=? AND baseline_id=?').get(v.correctsId,id)) throw new HttpError(400,'같은 기준본의 정정할 기록을 선택하세요.');
      const number=(db.prepare('SELECT count(*) AS n FROM cost_baseline_statements WHERE baseline_id=?').get(id) as {n:number}).n+1;
      if(number>1000) throw new HttpError(409,'기준본별 제출 진술 기록 1,000건 한도 초과');
      const body:Statement={schema:1,id:randomUUID(),baselineId:id,baselineHash:b.hash,number,submittedDate:v.submittedDate,memo:v.memo,correctsId:v.correctsId,actor:account(db,req.session.userId!),recordedAt:new Date().toISOString(),kind:'human-stated-submission'};
      const hash=journalHash(body);
      db.prepare('INSERT INTO cost_baseline_statements VALUES(?,?,?,?,?,?,?)').run(body.id,id,number,v.correctsId,JSON.stringify(body),hash,body.recordedAt);
      return {body,hash};
    },()=>{access(req,true,true);});
  });
  app.get(base+'/:baselineId/statements/:statementId/print',(req,res)=>{
    access(req,true,true);const result=read(()=>{
      const b=baselineView(db,String(req.params.siteId),String(req.params.id),String(req.params.baselineId));
      const row=db.prepare('SELECT body,hash FROM cost_baseline_statements WHERE id=? AND baseline_id=?').get(String(req.params.statementId),b.id) as {body:string;hash:string}|undefined;
      if(!row) throw new HttpError(404,'제출 진술 기록을 찾을 수 없습니다.');
      const body=JSON.parse(row.body) as Statement;if(journalHash(body)!==row.hash||body.baselineHash!==b.hash) throw new HttpError(409,'제출 진술 기록 해시 불일치');return {body,hash:row.hash};
    });res.type('html').send(printCostStatement(result.body,result.hash));
  });
}
