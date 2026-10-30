import type {Db} from "./db.js";
import {HttpError} from "./site-operations.js";
export type MinutesAttachment={id:string;filename:string;format:'image/png'|'image/jpeg'|'application/pdf';size:number;sha256:string;attached:number;uploaded_by:string;uploaded_at:string};
export function minutesAttachments(db:Db,id:string):MinutesAttachment[]{
 const rows=db.prepare('SELECT id,filename,format,size,sha256,attached,uploaded_by,uploaded_at FROM minutes_attachments WHERE minutes_id=? ORDER BY uploaded_at,id LIMIT 21').all(id) as MinutesAttachment[];
 if(rows.length>20)throw new HttpError(409,'회의록 보존 첨부 한도를 초과했습니다. 일부 목록만 사용하지 않습니다.');
 return rows;
}
export function minutesAttachmentManifest(db:Db,id:string){return minutesAttachments(db,id).filter(row=>row.attached===1);}
