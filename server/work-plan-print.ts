import { printHazardReferences } from "./work-plan-hazard-references.js";
import { printLifting } from "./work-plan-lifting.js";
import { printPlateReports } from "./work-plan-plate-reports.js";
import { printDesignations } from "./work-plan-designations.js";
import { printPlanPacket } from "./work-plan-packet.js";
import { printPlanForm } from "./work-plan-forms.js";
import type { WorkPlanAttachmentManifest } from "./work-plan-attachment-model.js";
import { escapeHtml as h } from "./print.js";
import { planMinutes, type WorkPlanBody } from "./work-plan-validation.js";
import type { WorkPlanSource } from "./work-plan-sources.js";
export function printWorkPlan(
  v: {
    recordKind?: "author_submission";
    attachmentManifest?:WorkPlanAttachmentManifest;
    id: string;
    version: number;
    site: { id: string; name: string };
    author: { id: string; name: string };
    body: WorkPlanBody;
    source: WorkPlanSource | null;
    parentId: string | null;
    revisionReason: string;
    archivedBy?: { id: string; name: string };
    archivedAt?: string;
  },
  hash: string | null,
) {
  const b = v.body;
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><title>수기 일반 작업계획</title><link rel="stylesheet" href="/print.css"><main><h1>수기 일반 작업계획 · ${hash ? (v.recordKind === "author_submission" ? "작성자 제출본" : "관리자 기록 보관본") : "초안"}</h1><p>작업허가·공학 검토·안전 인증·선임장·근로자 동의/서명이 아닙니다. 입력한 절차/주의사항과 담당 업무 메모입니다.</p><h2>${h(b.title)}</h2><p>${h(v.site.name)} · ${h(v.id)} v${v.version} · 작성계정 ${h(v.author.name)} (${h(v.author.id)})</p><p>${h(b.date)} ${h(b.startTime)}~${h(b.endTime)} · 현지 시각차 ${planMinutes(b)}분(법정근로시간/실제 경과시간 아님) · ${h(b.location)}</p><h2>작업 설명</h2><p>${h(b.workDescription)}</p><h2>절차와 주의사항</h2>${b.steps.map((s, i) => `<article><h3>${i + 1}. ${h(s.task)}</h3><p>${h(s.procedure)}</p><p>${h(s.precaution)}</p></article>`).join("")}<h2>비상 대응 절차</h2><p>${h(b.emergencyProcedure)}</p><h2>수기 자료 확인 메모</h2><p>${h(b.verificationNote)}</p>${b.hazardReferences?printHazardReferences(b.hazardReferences):""}${b.liftingDetail?printLifting(b.liftingDetail,v.attachmentManifest):""}${b.plateLoadReports?printPlateReports(b.plateLoadReports,v.attachmentManifest):""}${b.designationRecords?printDesignations(b.designationRecords,v.source):""}${b.documentForm?printPlanForm(b.documentForm):""}${b.documentPacket?printPlanPacket(b.documentPacket,v.attachmentManifest):""}<h2>선택 참조</h2>${v.source ? `<p>취합 ${h(v.source.capturedAt)} · ${h(v.source.fingerprint)}</p>${v.source.facts.equipment.map((e) => `<p>장비 ${h(e.body.name)} (${h(e.id)}) v${e.version} · ${h(e.body.typeLabel)} · 코드 ${h(e.asset_code)} · 입력한 검사예정일 ${h(e.dueMetadata?.nextInspectionDate || "미기록")} · 보험기록종료일 ${h(e.dueMetadata?.insuranceRecordedUntil || "미기록")}. 유효성 판단 아님.</p>`).join("")}${v.source.facts.duties.map((d) => `<p>명부 ${h(d.worker.name)} / ${h(d.worker.affiliation)} (${h(d.worker.id)}) v${d.worker.version} · 담당 업무 메모: ${h(d.duty)}. 본인확인/동의/선임 증명 아님.</p>`).join("")}` : "<p>선택한 참조를 아직 취합하지 않았습니다.</p>"}<p>원본 ${h(v.parentId || "없음")} · 정정사유 ${h(v.revisionReason)}</p>${hash ? `<p>${v.recordKind === "author_submission" ? "제출계정" : "보관계정"} ${h(v.archivedBy?.name)} (${h(v.archivedBy?.id)}) · ${h(v.archivedAt)} · ${h(hash)}</p>` : ""}${v.attachmentManifest?`<section><h2>고정 첨부 목록 · 미검사 원본</h2><p>목록과 해시만 표시합니다. 파일 구조/악성코드/법적 적합성 검증 또는 안전 인증이 아닙니다.</p>${v.attachmentManifest.items.map(a=>`<article><p>${h(a.filename)} · ${h(a.format)} · ${a.size} bytes · ${h(a.id)}</p><p>SHA-256 ${h(a.sha256)} · 업로드 ${h(a.uploaded_by)} · ${h(a.uploaded_at)}</p></article>`).join("")||"<p>연결 첨부 없음</p>"}</section>`:""}</main></html>`;
}
