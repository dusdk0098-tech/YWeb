import type {Express} from "express";
import type {Db} from "./db.js";
import {audit} from "./db.js";
import {HttpError,type SiteOperations} from "./site-operations.js";
import {account} from "./inspection-model.js";
import {getCatalog} from "./education-catalog-model.js";
import {catalogStopInput,catalogUseStatus,exactCatalog,type CatalogStopSnapshot} from "./education-catalog-use-model.js";
import {searchCatalog,catalogRegisterQuery} from "./education-catalog-register.js";
import {journalHash} from "./daily-journal-sources.js";
import {educationCatalogSource} from "./education-catalog-source.js";
import type {EducationInput} from "./education-validation.js";
export function registerCatalogUse(app:Express,db:Db,{access,mutate}:SiteOperations){
 const base="/api/sites/:siteId/education-catalog";
 app.get("/api/sites/:siteId/education-catalog-register",(req,res)=>{const role=access(req);res.json(searchCatalog(db,String(req.params.siteId),role,catalogRegisterQuery.parse(req.query)));});
 app.get(base+"/:id/use-status",(req,res)=>{
  const role=access(req),row=getCatalog(db,String(req.params.siteId),String(req.params.id));
  if(row.status==="draft"&&role!=="manager")throw new HttpError(404,"게시 교육내용을 찾을 수 없습니다.");res.json(catalogUseStatus(db,row));
 });
 app.post(base+"/:id/stop-use",(req,res)=>{
  access(req,true,true);const v=catalogStopInput.parse(req.body),site=String(req.params.siteId),id=String(req.params.id);
  mutate(req,res,`education_catalog:stop-use:${site}:${id}`,v,()=>{
   const row=getCatalog(db,site,id);if(row.version!==v.version)throw new HttpError(409,"교육내용 버전이 변경되었습니다.");exactCatalog(row,v.sourceHash);
   if(catalogUseStatus(db,row).useStopped)throw new HttpError(409,"이미 신규사용이 중지된 게시본입니다. 이 버전에는 해제가 없습니다.");
   const snapshot:CatalogStopSnapshot={catalogId:id,siteId:site,version:v.version,sourceHash:v.sourceHash,reason:v.reason,actor:account(db,req.session.userId!),at:new Date().toISOString()};
   db.prepare("INSERT INTO education_catalog_use_stops VALUES(?,?,?,?,?,?)").run(id,site,v.version,v.sourceHash,JSON.stringify(snapshot),journalHash(snapshot));audit(db,req.session.userId!,site,"education_catalog.use_stopped",id);return catalogUseStatus(db,row);
  },()=>{access(req,true,true);getCatalog(db,site,id);});
 });
 app.get("/api/sites/:siteId/education/:id/catalog-use-status",(req,res)=>{
  access(req);const site=String(req.params.siteId),id=String(req.params.id),journal=db.prepare("SELECT body FROM education_sessions WHERE id=? AND site_id=?").get(id,site) as {body:string}|undefined;
  if(!journal)throw new HttpError(404,"교육일지를 찾을 수 없습니다.");
  const source=educationCatalogSource(db,id,JSON.parse(journal.body) as EducationInput);
  if(!source){res.json({source:null,current:null});return;}
  const row=getCatalog(db,site,source.snapshot.id);exactCatalog(row,source.hash);
  res.json({source:{id:source.snapshot.id,version:source.snapshot.version,hash:source.hash},current:catalogUseStatus(db,row)});
 });
}
