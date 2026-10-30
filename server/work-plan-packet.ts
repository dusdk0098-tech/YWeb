import { validateHazardReferenceChanges, validateHazardSnapshot, resetHazardReferences } from "./work-plan-hazard-references.js";
import { validateLiftingReferences, validateLiftingSnapshot, resetLifting } from "./work-plan-lifting.js";
import { validatePlateReferences, validatePlateSnapshot, resetPlateReports } from "./work-plan-plate-reports.js";
import { validateDesignationReferences, validateDesignationSnapshot, resetDesignations } from "./work-plan-designations.js";
import type { Db } from './db.js';
import { HttpError } from './site-operations.js';
import { workPlanAttachments,type WorkPlanAttachmentManifest } from './work-plan-attachment-model.js';
import { planPacketSchema,completePacket } from './work-plan-packet-schema.js';
import { resetPacket,packetKinds,type PlanPacket } from './work-plan-packet-values.js';
import type { WorkPlanBody } from './work-plan-validation.js';
import { escapeHtml as h } from './print.js';
export function validatePacketReferences(db:Db,planId:string,body:WorkPlanBody){
 validateHazardReferenceChanges(db,planId,body);validateLiftingReferences(db,planId,body);validatePlateReferences(db,planId,body);validateDesignationReferences(body);
 const packet=body.documentPacket;if(!packet)return;
 if(packet.equipmentId&&!body.equipmentIds.includes(packet.equipmentId))throw new HttpError(409,'서류 목록의 장비를 계획 선택 장비에서 다시 확인하세요.');
 const active=new Set(workPlanAttachments(db,planId).filter(f=>f.attached===1).map(f=>f.id));
 for(const row of packet.rows)if(row.fileId&&!active.has(row.fileId))throw new HttpError(409,'서류 참조 파일이 이 계획에 없거나 분리되었습니다. 재선택 또는 미확보/해당 없음으로 명시 수정하세요.');
}
export function validatePacketSnapshot(snapshot:{body:WorkPlanBody;attachmentManifest?:WorkPlanAttachmentManifest}){
 validateHazardSnapshot(snapshot.body);validateLiftingSnapshot(snapshot.body,snapshot.attachmentManifest);validatePlateSnapshot(snapshot.body,snapshot.attachmentManifest);validateDesignationSnapshot(snapshot.body);
 if(!snapshot.body.documentPacket)return;
 const packet=planPacketSchema.parse(snapshot.body.documentPacket);
 if(!completePacket(packet)||!snapshot.body.equipmentIds.includes(packet.equipmentId!))throw new HttpError(409,'고정 장비서류 목록의 장비/구분/사유가 불일치합니다.');
 const ids=new Set(snapshot.attachmentManifest?.items.map(f=>f.id)||[]);
 if(!snapshot.attachmentManifest||packet.rows.some(r=>r.fileId&&!ids.has(r.fileId)))throw new HttpError(409,'고정 서류 참조와 첨부 manifest가 불일치합니다.');
}
export function resetPacketBody(body:WorkPlanBody):WorkPlanBody{const next=resetHazardReferences(resetLifting(resetPlateReports(resetDesignations(body))));return next.documentPacket?{...next,documentPacket:resetPacket(next.documentPacket)}:next;}
export function resetPacketBodyJson(body:string){const parsed=JSON.parse(body) as WorkPlanBody;return (parsed.documentPacket||parsed.designationRecords||parsed.plateLoadReports||parsed.liftingDetail||parsed.hazardReferences)?JSON.stringify(resetPacketBody(parsed)):body;}
export function printPlanPacket(packet:PlanPacket,manifest?:WorkPlanAttachmentManifest){
 return `<section><h2>선택 장비1대의 서류 참조 기록</h2><p>장비 UUID ${h(packet.equipmentId||'미선택')} · 전체 계획 장비의 서류목록이 아닙니다. 사용자가 분류/연결한 기록이며 면허·보험·교육·검사 유효성, 법적 적격성·선임·서명·파일 안전성을 판정하지 않습니다.</p>${packet.rows.map(r=>{const file=manifest?.items.find(f=>f.id===r.fileId);return `<article><h3>${h(packetKinds[r.kind])}</h3><p>${r.state===null?'미입력':r.state==='linked'?'사용자 파일 참조':r.state==='missing'?'미확보로 기록':'해당 없음으로 기록'}</p><p>${h(r.note)}</p>${r.state==='linked'?(file?`<p>${h(file.filename)} · ${h(file.id)} · ${h(file.format)} · ${file.size} bytes · SHA-256 ${h(file.sha256)}</p>`:'<p>참조 불가/미선택 — 확인 완료로 표시하지 않습니다.</p>'):''}</article>`;}).join('')}<p>원본 페이지/사진 배치·PDF/법적 검토 인증 아님. 같은 파일의 여러 분류 참조는 여러 증명서의 인증이 아닙니다.</p></section>`;
}
