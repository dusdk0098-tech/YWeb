import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { account } from "./inspection-model.js";
import { inspectionPage } from "./inspection-validation.js";
import { journalMonth, buildMonthlyReport } from "./daily-monthly-report.js";
import { journalHash } from "./daily-journal-sources.js";
import { serializeMonthlyRecord, monthlyRecordCreate, latestMonthlyRecord, fixedMonthlyRecord, compareMonthlyRecord, type MonthlyRecordBody } from "./daily-monthly-record-model.js";
import { printMonthlyRecord } from "./daily-monthly-record-print.js";
export function registerDailyMonthlyRecords(app:Express,db:Db,{access,mutate}:SiteOperations) {
  const base="/api/sites/:siteId/daily-monthly-records";
  function read<T>(fn:()=>T):T {db.exec("BEGIN DEFERRED");try {const out=fn();db.exec("COMMIT");return out;}catch(error){db.exec("ROLLBACK");throw error;}}
  app.get(base,(req,res)=>{
    access(req);const q=inspectionPage.extend({month:journalMonth}).parse(req.query),site=String(req.params.siteId);
    res.json(read(()=>{
      const rows=db.prepare("SELECT id,number,hash,created_at FROM daily_monthly_records WHERE site_id=? AND month=? ORDER BY number DESC LIMIT 51 OFFSET ?").all(site,q.month,q.offset);
      return {items:rows.slice(0,50),hasMore:rows.length>50,latest:latestMonthlyRecord(db,site,q.month)||null};
    }));
  });
  app.post(base,(req,res)=>{
    access(req,true,true);const v=monthlyRecordCreate.parse(req.body),site=String(req.params.siteId);
    mutate(req,res,`daily-monthly:record:${site}:${v.month}`,v,()=>{
      const latest=latestMonthlyRecord(db,site,v.month);
      if((latest?.id||null)!==v.expectedLatestId) throw new HttpError(409,"후속 월간 기록이 있습니다. 다시 조회하세요.");
      const report=buildMonthlyReport(db,site,v.month);
      if(report.fingerprint!==v.expectedFingerprint) throw new HttpError(409,"조회 후 일지/현장 표시가 변경되었습니다. 다시 조회하세요.");
      const previous=latest?fixedMonthlyRecord(db,site,latest.id):null;
      if(previous?.body.report.fingerprint===report.fingerprint) throw new HttpError(409,"현재 조회 내용은 마지막 고정 기록과 같습니다. 기존 기록을 사용하세요.");
      const number=(latest?.number||0)+1;
      if(number>1000) throw new HttpError(409,"같은 현장·월의 고정 기록 1,000개 한도를 넘었습니다.");
      const now=new Date().toISOString(),body:MonthlyRecordBody={schema:1,id:randomUUID(),number,parentId:latest?.id||null,parentHash:previous?.hash||null,report,actor:account(db,req.session.userId!),recordedAt:now,reason:v.reason,kind:"saved-month-view-not-approval"};
      const text=serializeMonthlyRecord(body);
      db.prepare("INSERT INTO daily_monthly_records VALUES(?,?,?,?,?,?,?,?)").run(body.id,site,v.month,number,body.parentId,text,journalHash(body),now);
      audit(db,body.actor.id,site,"daily.monthly-record",body.id);
      return fixedMonthlyRecord(db,site,body.id);
    },()=>{access(req,true,true);});
  });
  app.get(base+"/:recordId",(req,res)=>{access(req);res.json(read(()=>fixedMonthlyRecord(db,String(req.params.siteId),String(req.params.recordId))));});
  app.get(base+"/:recordId/compare",(req,res)=>{access(req);res.json(read(()=>compareMonthlyRecord(db,fixedMonthlyRecord(db,String(req.params.siteId),String(req.params.recordId)))));});
  app.get(base+"/:recordId/print",(req,res)=>{access(req);const record=read(()=>fixedMonthlyRecord(db,String(req.params.siteId),String(req.params.recordId)));res.type("html").send(printMonthlyRecord(record));});
}
