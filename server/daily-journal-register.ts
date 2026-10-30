import type { Express } from "express";
import { z } from "zod";
import type { Db } from "./db.js";
import type { SiteOperations } from "./site-operations.js";
import { date } from "./validation.js";
import { inspectionPage } from "./inspection-validation.js";
export const dailyRegisterQuery=inspectionPage.extend({
  from:date.optional(),to:date.optional(),status:z.enum(["draft","archived"]).optional(),q:z.string().trim().max(200).default(""),
}).refine(v=>!v.from||!v.to||v.from<=v.to,"날짜 범위를 확인하세요.");
export function readDailyRegister(db:Db,site:string,q:z.infer<typeof dailyRegisterQuery>) {
  const where="site_id=? AND (? IS NULL OR date>=?) AND (? IS NULL OR date<=?) AND (? IS NULL OR status=?) AND (?='' OR instr(lower(COALESCE(json_extract(body,'$.workSummary'),'')),lower(?))>0 OR instr(lower(COALESCE(json_extract(body,'$.workLocations'),'')),lower(?))>0 OR instr(lower(COALESCE(json_extract(body,'$.observations'),'')),lower(?))>0)";
  const args=[site,q.from||null,q.from||null,q.to||null,q.to||null,q.status||null,q.status||null,q.q,q.q,q.q,q.q];
  db.exec("BEGIN DEFERRED");
  try {
    const total=(db.prepare(`SELECT count(*) n FROM daily_journals WHERE ${where}`).get(...args) as {n:number}).n;
    const rows=db.prepare(`SELECT id,date,status,version,parent_id,json_extract(body,'$.workSummary') workSummary,json_extract(body,'$.workLocations') workLocations FROM daily_journals WHERE ${where} ORDER BY date DESC,created_at DESC,id LIMIT 50 OFFSET ?`).all(...args,q.offset);
    db.exec("COMMIT");return {items:rows,total,hasMore:q.offset+rows.length<total,offset:q.offset};
  } catch(error){db.exec("ROLLBACK");throw error;}
}
export function registerDailyJournalRegister(app:Express,db:Db,{access}:SiteOperations) {
  app.get("/api/sites/:siteId/daily-journal-register",(req,res)=>{access(req);res.json(readDailyRegister(db,String(req.params.siteId),dailyRegisterQuery.parse(req.query)));});
}
