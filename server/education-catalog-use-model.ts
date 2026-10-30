import {z} from "zod";
import type {Db} from "./db.js";
import {HttpError} from "./site-operations.js";
import {revision} from "./validation.js";
import {getCatalog,publishedCatalog,type CatalogRow} from "./education-catalog-model.js";
import {journalHash} from "./daily-journal-sources.js";
export const catalogSourceHash=z.string().regex(/^[a-f0-9]{64}$/);
export const catalogStopInput=z.object({version:revision,sourceHash:catalogSourceHash,reason:z.string().trim().min(1).max(1000),confirmNoUndo:z.literal(true)}).strict();
export type CatalogStopSnapshot={catalogId:string;siteId:string;version:number;sourceHash:string;reason:string;actor:{id:string;name:string};at:string};
export function exactCatalog(row:CatalogRow,hash?:string){const source=publishedCatalog(row);if(hash!==undefined&&hash!==row.published_hash)throw new HttpError(409,"선택한 게시본 해시가 다릅니다. 원문을 다시 확인하세요.");return source;}
export function catalogUseStatus(db:Db,row:CatalogRow){
 if(row.status==="published")publishedCatalog(row);
 const stop=db.prepare("SELECT * FROM education_catalog_use_stops WHERE catalog_id=? AND site_id=?").get(row.id,row.site_id) as {source_version:number;source_hash:string;snapshot:string;snapshot_hash:string}|undefined;
 let stopped:CatalogStopSnapshot|null=null;
 if(stop){
  stopped=JSON.parse(stop.snapshot) as CatalogStopSnapshot;
  if(journalHash(stopped)!==stop.snapshot_hash||stop.source_version!==row.version||stop.source_hash!==row.published_hash||stopped.catalogId!==row.id||stopped.siteId!==row.site_id||stopped.version!==row.version||stopped.sourceHash!==row.published_hash||row.status!=="published")throw new HttpError(409,"교육내용 사용중지 출처가 일치하지 않습니다.");
 }
 const successor=db.prepare("SELECT id,version,published_hash FROM education_catalog WHERE parent_id=? AND site_id=? AND status='published'").get(row.id,row.site_id) as {id:string;version:number;published_hash:string}|undefined;
 if(successor)publishedCatalog(getCatalog(db,row.site_id,successor.id));
 return {catalogId:row.id,version:row.version,sourceHash:row.published_hash,useStopped:!!stopped,stop:stopped,publishedSuccessor:successor?{id:successor.id,version:successor.version,hash:successor.published_hash}:null};
}
export function assertCatalogNewUse(db:Db,row:CatalogRow){if(catalogUseStatus(db,row).useStopped)throw new HttpError(409,"이 게시본의 신규 사용은 중지되었습니다. 기존 일지는 바뀌지 않습니다. 다른 게시본을 직접 선택하세요.");}
