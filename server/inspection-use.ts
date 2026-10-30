import {createHash} from "node:crypto";
import {z} from "zod";
import type {Db} from "./db.js";
import {HttpError} from "./site-operations.js";
import type {TemplateRow,TemplateSnapshot} from "./inspection-model.js";
import {revision} from "./validation.js";
export const inspectionHash=z.string().regex(/^[a-f0-9]{64}$/);
export const inspectionSelection={templateVersion:revision.optional(),templateHash:inspectionHash.optional()};
export const inspectionStopInput=z.object({version:revision,sourceHash:inspectionHash,reason:z.string().trim().min(1).max(1000),confirmNoUndo:z.literal(true)}).strict();
export const rawInspectionHash=(s:string)=>createHash("sha256").update(s).digest("hex");
export function templateFingerprint(row:TemplateRow){
 if(row.status!=="published"||!row.published_snapshot)throw new HttpError(409,"정확한 게시 양식을 선택하세요.");
 const snap=JSON.parse(row.published_snapshot) as TemplateSnapshot;
 if(snap.id!==row.id||snap.version!==row.version||JSON.stringify(snap.body)!==row.body)throw new HttpError(409,"게시 양식 출처가 일치하지 않습니다.");
 return rawInspectionHash(row.published_snapshot);
}
export type InspectionStop={templateId:string;siteId:string;version:number;sourceHash:string;reason:string;actor:{id:string;name:string};at:string};
export function inspectionUse(db:Db,row:TemplateRow){
 const hash=row.status==="published"?templateFingerprint(row):null;
 const saved=db.prepare("SELECT snapshot,hash FROM inspection_template_use_stops WHERE template_id=? AND site_id=?").get(row.id,row.site_id) as {snapshot:string;hash:string}|undefined;
 let stop:InspectionStop|null=null;
 if(saved){stop=JSON.parse(saved.snapshot) as InspectionStop;if(rawInspectionHash(saved.snapshot)!==saved.hash||stop.templateId!==row.id||stop.siteId!==row.site_id||stop.version!==row.version||stop.sourceHash!==hash)throw new HttpError(409,"양식 중지 기록의 출처가 일치하지 않습니다.");}
 const child=db.prepare("SELECT id,status,version FROM inspection_templates WHERE site_id=? AND parent_id=?").get(row.site_id,row.id) as {id:string;status:string;version:number}|undefined;
 return {templateId:row.id,version:row.version,sourceHash:hash,stop,useStopped:!!stop,successor:child||null};
}
export function assertInspectionNewUse(db:Db,row:TemplateRow,selection:{templateVersion?:number;templateHash?:string}={}){
 const hash=templateFingerprint(row);
 if((selection.templateVersion!==undefined&&selection.templateVersion!==row.version)||(selection.templateHash!==undefined&&selection.templateHash!==hash))throw new HttpError(409,"선택한 게시 양식 버전/해시가 다릅니다.");
 if(inspectionUse(db,row).useStopped)throw new HttpError(409,"신규사용 중지 양식입니다. 이미 고정한 일정/점검은 계속 진행할 수 있습니다.");
}
