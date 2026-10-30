import type {Db} from "./db.js";
import {HttpError} from "./site-operations.js";
export type WorkPlanAttachment={id:string;filename:string;format:'image/png'|'image/jpeg'|'application/pdf';size:number;sha256:string;attached:number;uploaded_by:string;uploaded_at:string};
export function workPlanAttachments(db:Db,id:string):WorkPlanAttachment[]{
 const rows=db.prepare('SELECT id,filename,format,size,sha256,attached,uploaded_by,uploaded_at FROM work_plan_attachments WHERE plan_id=? ORDER BY uploaded_at,id LIMIT 21').all(id) as WorkPlanAttachment[];
 if(rows.length>20)throw new HttpError(409,'작업계획 보존 첨부 한도를 초과했습니다. 일부 목록만 사용하지 않습니다.');
 return rows;
}
export function workPlanAttachmentManifest(db:Db,id:string){return workPlanAttachments(db,id).filter(row=>row.attached===1);}

export type WorkPlanAttachmentManifest = {schemaVersion:1;items:WorkPlanAttachment[]};
export function fixedWorkPlanAttachments(db:Db,id:string):WorkPlanAttachmentManifest{return {schemaVersion:1,items:workPlanAttachmentManifest(db,id)};}
export function validateWorkPlanAttachments(db:Db,id:string,snapshot:{attachmentManifest?:WorkPlanAttachmentManifest}){
 const rows=workPlanAttachments(db,id);
 if(snapshot.attachmentManifest===undefined){if(rows.length)throw new HttpError(409,"기존 보관본에 없는 첨부가 발견되었습니다.");return;}
 if(!snapshot.attachmentManifest||snapshot.attachmentManifest.schemaVersion!==1||JSON.stringify(snapshot.attachmentManifest.items)!==JSON.stringify(rows.filter(r=>r.attached===1)))throw new HttpError(409,"작업계획 고정 첨부 목록이 일치하지 않습니다.");
}
