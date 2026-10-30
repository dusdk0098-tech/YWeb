import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { inspectionPage } from "./inspection-validation.js";
import { catalogBody,getCatalog,publishedCatalog,type CatalogRow } from "./education-catalog-model.js";
import { catalogUseStatus } from "./education-catalog-use-model.js";
import { educationPreviewInput,educationImportInput,educationExportInput,educationContentRecord,previewEducationContent,contentExport } from "./education-transfer-model.js";
export function registerEducationTransfer(app:Express,db:Db,{access,mutate}:SiteOperations) {
 const base='/api/sites/:siteId/education-content-transfer';
 function read<T>(fn:()=>T):T{db.exec('BEGIN');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
 app.post(base+'/preview',(req,res)=>{access(req,true,true);res.json(previewEducationContent(educationPreviewInput.parse(req.body)));});
 app.post(base+'/import',(req,res)=>{
  access(req,true,true);const input=educationImportInput.parse(req.body),site=String(req.params.siteId);
  mutate(req,res,`education-content:import:${site}`,input,()=>{
   const preview=previewEducationContent({text:input.text});
   if(preview.digest!==input.previewDigest)throw new HttpError(409,'미리보기 이후 JSON 원문이 달라졌습니다. 다시 미리보기하세요.');
   if(input.selectedIndexes.some(i=>i>=preview.rows.length))throw new HttpError(400,'미리보기에 없는 행을 선택했습니다.');
   const now=new Date().toISOString(),created: {index:number;id:string;version:1;status:'draft';title:string}[]=[];
   for(const index of input.selectedIndexes){
    const body=catalogBody.parse({...preview.rows[index].body,referenceNote:''}),id=randomUUID();
    db.prepare("INSERT INTO education_catalog VALUES(?,?,NULL,?,'draft',1,NULL,NULL,?,?)").run(id,site,JSON.stringify(body),now,now);
    audit(db,req.session.userId!,site,'education_catalog.imported_draft',id);
    created.push({index,id,version:1,status:'draft',title:body.title});
   }
   return {digest:preview.digest,created,rightsDeclaration:'user-assertion-only',warning:'새 미게시 초안입니다. 게시/사용중지/승인/참여/권리검증 상태는 가져오지 않았습니다.'};
  },()=>{access(req,true,true);});
 });
 app.get(base+'/candidates',(req,res)=>{
  access(req,true,true);const site=String(req.params.siteId),q=inspectionPage.parse(req.query);
  res.json(read(()=>{
   const rows=db.prepare('SELECT * FROM education_catalog WHERE site_id=? ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET ?').all(site,q.offset) as CatalogRow[];
   return {items:rows.slice(0,50).map(row=>{const body=catalogBody.parse(JSON.parse(row.body)),use=catalogUseStatus(db,row);return {id:row.id,version:row.version,title:body.title,categoryLabel:body.categoryLabel,status:row.status,useStopped:use.useStopped};}),hasMore:rows.length>50};
  }));
 });
 app.post(base+'/export',(req,res)=>{
  access(req,true,true);const v=educationExportInput.parse(req.body),site=String(req.params.siteId);
  const text=read(()=>contentExport(v.selections.map(selection=>{
   const row=getCatalog(db,site,selection.id);if(row.version!==selection.version)throw new HttpError(409,'선택한 교육내용 버전이 달라졌습니다. 다시 선택하세요.');
   // Use-stop forbids new journal use, not the manager's existing content read/export.
   catalogUseStatus(db,row);
   const body=catalogBody.parse(row.status==='published'?publishedCatalog(row).body:JSON.parse(row.body));
   return educationContentRecord.parse({title:body.title,categoryLabel:body.categoryLabel,objectives:body.objectives,contents:body.contents});
  })));
  res.set('Content-Disposition','attachment; filename="own-education-content-v1.json"').type('json').send(text);
 });
}
