import {z} from "zod";
import type {Db} from "./db.js";
import {catalogRecord,type CatalogRow} from "./education-catalog-model.js";
import {catalogUseStatus} from "./education-catalog-use-model.js";
export const catalogRegisterQuery=z.object({offset:z.coerce.number().int().min(0).max(100000).default(0),keyword:z.string().trim().max(200).default(""),status:z.enum(["draft","published"]).optional(),lineage:z.enum(["all","visible_leaf","has_visible_successor"]).default("all"),use:z.enum(["all","available","stopped"]).default("all")}).strict();
export type CatalogRegisterQuery=z.infer<typeof catalogRegisterQuery>;
export function searchCatalog(db:Db,site:string,role:string,q:CatalogRegisterQuery){
 const successor="EXISTS(SELECT 1 FROM education_catalog child WHERE child.parent_id=c.id AND child.site_id=c.site_id AND (?='manager' OR child.status='published'))";
 const conditions=["c.site_id=?","(?='manager' OR c.status='published')"],args:(string|number)[]=[site,role];
 if(q.status){conditions.push("c.status=?");args.push(q.status);}
 if(q.keyword){conditions.push("(instr(lower(json_extract(c.body,'$.title')),lower(?))>0 OR instr(lower(json_extract(c.body,'$.categoryLabel')),lower(?))>0 OR instr(lower(json_extract(c.body,'$.contents')),lower(?))>0)");args.push(q.keyword,q.keyword,q.keyword);}
 if(q.lineage!=="all"){conditions.push((q.lineage==="visible_leaf"?"NOT ":"")+successor);args.push(role);}
 if(q.use!=="all"){conditions.push("c.status='published'");conditions.push((q.use==="available"?"NOT ":"")+"EXISTS(SELECT 1 FROM education_catalog_use_stops x WHERE x.catalog_id=c.id)");}
 const where=conditions.join(" AND ");
 db.exec("BEGIN");try{
  const total=Number(db.prepare(`SELECT COUNT(*) n FROM education_catalog c WHERE ${where}`).get(...args)?.n);
  const rows=db.prepare(`SELECT c.* FROM education_catalog c WHERE ${where} ORDER BY c.created_at DESC,c.id DESC LIMIT 50 OFFSET ?`).all(...args,q.offset) as CatalogRow[];
  const items=rows.map(row=>{const record=catalogRecord(db,row),child=record.successorId?db.prepare("SELECT status FROM education_catalog WHERE id=? AND site_id=?").get(record.successorId,site):null;return {id:row.id,version:row.version,status:row.status,parentId:row.parent_id,title:record.body.title,categoryLabel:record.body.categoryLabel,preview:record.body.contents.slice(0,160),sourceHash:row.published_hash,visibleSuccessorId:role==="manager"||child?.status==="published"?record.successorId:null,current:catalogUseStatus(db,row)};});
  db.exec("COMMIT");return {items,total,offset:q.offset,hasMore:q.offset+items.length<total};
 }catch(error){db.exec("ROLLBACK");throw error;}
}
