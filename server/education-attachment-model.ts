import { createHash } from "node:crypto";
import type { Db } from "./db.js";
import type { EducationRow, EducationSnapshot } from "./education.js";
import { HttpError } from "./site-operations.js";
import { escapeHtml } from "./print.js";
export type EducationAttachment={id:string;filename:string;format:'image/png'|'image/jpeg'|'application/pdf';size:number;sha256:string;attached:number;uploaded_by:string;uploaded_at:string};
export function getEducationForAttachment(db:Db,site:string,id:string){
 const r=db.prepare('SELECT * FROM education_sessions WHERE id=? AND site_id=?').get(id,site) as EducationRow|undefined;
 if(!r)throw new HttpError(404,'교육일지를 찾을 수 없습니다.');return r;
}
export function educationAttachments(db:Db,id:string){
 const rows=db.prepare('SELECT id,filename,format,size,sha256,attached,uploaded_by,uploaded_at FROM education_attachments WHERE session_id=? ORDER BY uploaded_at,id LIMIT 21').all(id) as EducationAttachment[];
 if(rows.length>20)throw new HttpError(409,'교육일지 보존 원본20개 한도입니다. 일부 목록만 표시하지 않습니다.');return rows;
}
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export type EducationAttachmentManifest={schemaVersion:1;sessionId:string;siteId:string;snapshotHash:string;items:EducationAttachment[]};
export function boundedEducationManifest(value:unknown){const text=JSON.stringify(value);if(Buffer.byteLength(text)>256*1024)throw new HttpError(409,'교육 원본 고정 목록256KiB 한도 초과. 전체 보관을 중단합니다.');return text;}
export function captureEducationAttachments(db:Db,site:string,id:string,snapshotHash:string){
 const manifest:EducationAttachmentManifest={schemaVersion:1,sessionId:id,siteId:site,snapshotHash,items:educationAttachments(db,id).filter(r=>r.attached===1)};
 const text=boundedEducationManifest(manifest);db.prepare('INSERT INTO education_archive_attachments VALUES(?,?,?,?)').run(id,snapshotHash,text,hash(text));
}
export function fixedEducationAttachments(db:Db,site:string,id:string){
 const record=getEducationForAttachment(db,site,id);
 if(record.status!=='archived')throw new HttpError(409,'보관된 교육일지에서 고정 목록을 조회하세요.');
 const snap=db.prepare('SELECT body,hash FROM education_snapshots WHERE session_id=?').get(id) as {body:string;hash:string}|undefined;
 if(!snap||hash(snap.body)!==snap.hash)throw new HttpError(409,'교육 보관 원문 해시 불일치');
 let body:EducationSnapshot;try{body=JSON.parse(snap.body) as EducationSnapshot;}catch{throw new HttpError(409,'교육 보관 원문을 읽을 수 없습니다.');}
 if(body?.schemaVersion!==1||body.version!==record.version||body.id!==id||body.site?.id!==site||body.type!=='education-journal')throw new HttpError(409,'교육 보관 출처 불일치');
 const row=db.prepare('SELECT * FROM education_archive_attachments WHERE session_id=?').get(id) as {snapshot_hash:string;manifest:string;hash:string}|undefined;
 const attached=educationAttachments(db,id).filter(r=>r.attached===1);
 if(!row){if(educationAttachments(db,id).length)throw new HttpError(409,'과거 미기록 보관본에 원본이 존재하여 조회를 중단합니다.');return {recorded:false as const,sessionId:id,snapshotHash:snap.hash};}
 if(Buffer.byteLength(row.manifest)>256*1024||row.snapshot_hash!==snap.hash||hash(row.manifest)!==row.hash)throw new HttpError(409,'교육 고정 원본 목록 해시/한도 불일치');
 let manifest:EducationAttachmentManifest;try{manifest=JSON.parse(row.manifest) as EducationAttachmentManifest;}catch{throw new HttpError(409,'교육 원본 목록을 읽을 수 없습니다.');}
 if(manifest?.schemaVersion!==1||manifest.sessionId!==id||manifest.siteId!==site||manifest.snapshotHash!==snap.hash||JSON.stringify(manifest.items)!==JSON.stringify(attached))throw new HttpError(409,'교육 고정 원본 출처/목록 불일치');
 return {recorded:true as const,sessionId:id,snapshotHash:snap.hash,manifest,hash:row.hash};
}
export function printEducationAttachments(value:ReturnType<typeof fixedEducationAttachments>){
 const e=escapeHtml;return `<!doctype html><html lang="ko"><meta charset="utf-8"><title>교육 고정 원본 목록</title><h1>교육 고정 원본 목록</h1><p>교육일지 ${e(value.sessionId)} · 보관 원문 SHA256 ${e(value.snapshotHash)}</p><p>미검사 다운로드 전용 참조입니다. 참석·교육 이수·전자서명·진위·법적 적격·금융 증빙 인증이 아닙니다. 원 교육일지 인쇄와 별도 목록입니다.</p>${value.recorded?`<p>목록 SHA256 ${e(value.hash)} · ${value.manifest.items.length}개</p>${value.manifest.items.map(a=>`<article><h2>${e(a.filename)}</h2><p>${e(a.format)} · ${a.size} bytes · ${e(a.sha256)}</p><a href="/api/sites/${e(value.manifest.siteId)}/education/${e(value.sessionId)}/attachments/${e(a.id)}/download">미검사 원본 다운로드</a></article>`).join('')}`:'<p>과거 원본 목록 미기록. 빈 목록으로 판단하지 않습니다.</p>'}</html>`;
}
