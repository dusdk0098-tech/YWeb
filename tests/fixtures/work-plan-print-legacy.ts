import { escapeHtml as h } from "../../server/print.js";
import { planMinutes, type WorkPlanBody } from "../../server/work-plan-validation.js";
import type { WorkPlanSource } from "../../server/work-plan-sources.js";
export function printLegacyWorkPlan(
  v: {
    recordKind?: "author_submission";
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
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><title>수기 일반 작업계획</title><link rel="stylesheet" href="/print.css"><main><h1>수기 일반 작업계획 · ${hash ? (v.recordKind === "author_submission" ? "작성자 제출본" : "관리자 기록 보관본") : "초안"}</h1><p>작업허가·공학 검토·안전 인증·선임장·근로자 동의/서명이 아닙니다. 입력한 절차/주의사항과 담당 업무 메모입니다.</p><h2>${h(b.title)}</h2><p>${h(v.site.name)} · ${h(v.id)} v${v.version} · 작성계정 ${h(v.author.name)} (${h(v.author.id)})</p><p>${h(b.date)} ${h(b.startTime)}~${h(b.endTime)} · 현지 시각차 ${planMinutes(b)}분(법정근로시간/실제 경과시간 아님) · ${h(b.location)}</p><h2>작업 설명</h2><p>${h(b.workDescription)}</p><h2>절차와 주의사항</h2>${b.steps.map((s, i) => `<article><h3>${i + 1}. ${h(s.task)}</h3><p>${h(s.procedure)}</p><p>${h(s.precaution)}</p></article>`).join("")}<h2>비상 대응 절차</h2><p>${h(b.emergencyProcedure)}</p><h2>수기 자료 확인 메모</h2><p>${h(b.verificationNote)}</p><h2>선택 참조</h2>${v.source ? `<p>취합 ${h(v.source.capturedAt)} · ${h(v.source.fingerprint)}</p>${v.source.facts.equipment.map((e) => `<p>장비 ${h(e.body.name)} (${h(e.id)}) v${e.version} · ${h(e.body.typeLabel)} · 코드 ${h(e.asset_code)} · 입력한 검사예정일 ${h(e.dueMetadata?.nextInspectionDate || "미기록")} · 보험기록종료일 ${h(e.dueMetadata?.insuranceRecordedUntil || "미기록")}. 유효성 판단 아님.</p>`).join("")}${v.source.facts.duties.map((d) => `<p>명부 ${h(d.worker.name)} / ${h(d.worker.affiliation)} (${h(d.worker.id)}) v${d.worker.version} · 담당 업무 메모: ${h(d.duty)}. 본인확인/동의/선임 증명 아님.</p>`).join("")}` : "<p>선택한 참조를 아직 취합하지 않았습니다.</p>"}<p>원본 ${h(v.parentId || "없음")} · 정정사유 ${h(v.revisionReason)}</p>${hash ? `<p>${v.recordKind === "author_submission" ? "제출계정" : "보관계정"} ${h(v.archivedBy?.name)} (${h(v.archivedBy?.id)}) · ${h(v.archivedAt)} · ${h(hash)}</p>` : ""}</main></html>`;
}
