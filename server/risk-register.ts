import type { Express } from "express";
import { z } from "zod";
import type { Db } from "./db.js";
import { date } from "./validation.js";
import { companyPage } from "./companies.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
export const riskRegisterQuery=companyPage.extend({
  dateFrom:date.optional(),dateTo:date.optional(),
  method:z.enum(["product","three_level","checklist","narrative"]).optional(),
  status:z.enum(["draft","submitted","accepted","returned"]).optional(),
  lineage:z.enum(["all","leaf","prior"]).default("all"),
  keyword:z.string().trim().max(100).default(""),
}).strict().refine(q=>!q.dateFrom||!q.dateTo||q.dateFrom<=q.dateTo,"평가일 범위가 역전되었습니다.");
export type RiskRegisterQuery=z.infer<typeof riskRegisterQuery>;
const rowSchema=z.object({
 id:z.uuid(),version:z.number().int().positive(),title:z.string(),date,
 method:z.enum(["product","three_level","checklist","narrative"]),
 status:z.enum(["draft","submitted","accepted","returned"]),
 authorId:z.uuid(),authorName:z.string(),createdAt:z.string(),updatedAt:z.string(),
 parentId:z.uuid().nullable(),successorId:z.uuid().nullable(),
});
export type RiskRegisterItem=z.infer<typeof rowSchema>;
export type RiskRegisterPage={siteId:string;query:RiskRegisterQuery;generatedAt:string;total:number;offset:number;pageSize:50;hasMore:boolean;items:RiskRegisterItem[]};
export function readRiskRegister(db:Db,siteId:string,input:unknown,authorize:()=>void):RiskRegisterPage {
 const q=riskRegisterQuery.parse(input);
 db.exec("BEGIN DEFERRED");
 try{
  authorize();
  // Generated through existing strict methods; reject invalid common search data instead of silently hiding it.
  if(db.prepare("SELECT 1 FROM risk_assessments WHERE site_id=? AND NOT json_valid(body) LIMIT 1").get(siteId))throw new HttpError(409,"검색할 평가 본문이 올바르지 않습니다.");
  const invalid=db.prepare(`SELECT 1 FROM risk_assessments d WHERE d.site_id=? AND (
    json_type(d.body,'$.method') IS NOT 'text' OR json_extract(d.body,'$.method') NOT IN ('product','three_level','checklist','narrative') OR
    json_type(d.body,'$.date') IS NOT 'text' OR length(json_extract(d.body,'$.date'))!=10 OR json_extract(d.body,'$.date') NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' OR date(json_extract(d.body,'$.date'),'+0 days') IS NULL OR date(json_extract(d.body,'$.date'),'+0 days')!=json_extract(d.body,'$.date') OR
    json_type(d.body,'$.title') IS NOT 'text' OR json_type(d.body,'$.workScope') IS NOT 'text' OR json_type(d.body,'$.hazards') IS NOT 'array' OR
    EXISTS(SELECT 1 FROM json_each(d.body,'$.hazards') h WHERE CASE WHEN h.type='object' THEN json_type(h.value,'$.task') IS NOT 'text' ELSE 1 END)
   ) LIMIT 1`).get(siteId);
  if(invalid)throw new HttpError(409,"방법·평가일·검색 필드가 올바르지 않습니다. 일부 문서를 숨기지 않고 중단했습니다.");
  const where=`d.site_id=?
    AND (? IS NULL OR json_extract(d.body,'$.date')>=?) AND (? IS NULL OR json_extract(d.body,'$.date')<=?)
    AND (? IS NULL OR json_extract(d.body,'$.method')=?) AND (? IS NULL OR d.status=?)
    AND (?='all' OR (?='leaf' AND d.successor_id IS NULL) OR (?='prior' AND d.successor_id IS NOT NULL))
    AND (?='' OR instr(json_extract(d.body,'$.title'),?)>0 OR instr(json_extract(d.body,'$.workScope'),?)>0 OR EXISTS(SELECT 1 FROM json_each(d.body,'$.hazards') h WHERE instr(json_extract(h.value,'$.task'),?)>0))`;
  const params=[siteId,q.dateFrom??null,q.dateFrom??null,q.dateTo??null,q.dateTo??null,q.method??null,q.method??null,q.status??null,q.status??null,q.lineage,q.lineage,q.lineage,q.keyword,q.keyword,q.keyword,q.keyword];
  const total=(db.prepare(`SELECT COUNT(*) n FROM risk_assessments d WHERE ${where}`).get(...params) as {n:number}).n;
  const rows=db.prepare(`SELECT d.id,d.version,json_extract(d.body,'$.title') title,json_extract(d.body,'$.date') date,json_extract(d.body,'$.method') method,d.status,d.author_id authorId,u.name authorName,d.created_at createdAt,d.updated_at updatedAt,d.parent_id parentId,d.successor_id successorId FROM risk_assessments d JOIN users u ON u.id=d.author_id WHERE ${where} ORDER BY d.created_at DESC,d.id ASC LIMIT 50 OFFSET ?`).all(...params,q.offset);
  const items=rows.map(row=>rowSchema.parse(row));
  db.exec("COMMIT");
  return {siteId,query:q,generatedAt:new Date().toISOString(),total,offset:q.offset,pageSize:50,hasMore:q.offset+items.length<total,items};
 }catch(e){db.exec("ROLLBACK");throw e;}
}
export function registerRiskRegister(app:Express,db:Db,{access}:SiteOperations){
 app.get("/api/sites/:siteId/risk-assessment-register",(req,res)=>{
  access(req);res.json(readRiskRegister(db,String(req.params.siteId),req.query,()=>{access(req);}));
 });
}
