import { escapeHtml as e } from "./print.js";
import type { InspectionLink } from "./inspection-links.js";
export function printInspectionSource(link: InspectionLink | null) {
  if (!link) return "";
  const s = link.snapshot;
  return `<section><h2>불변 점검 출처</h2><p>원 점검 <a href="/api/sites/${e(link.site_id)}/inspections/${e(s.inspectionId)}/print">${e(s.inspectionId)}</a> v${s.inspectionVersion} · 양식 ${e(s.templateTitle)} (${e(s.templateId)} v${s.templateVersion})</p><p>${e(s.siteName)} · ${e(s.date)} · ${e(s.location)}</p><p>원 항목 ${e(s.item.id)}: ${e(s.item.text)} · 부적합</p><p>당시 설명: ${e(s.item.comment)}</p><p>원 제출 계정 ${e(s.submitter.name)} (${e(s.submitter.id)}) · ${e(s.submittedAt)}</p><p>연결 계정 ${e(s.linkedBy.name)} (${e(s.linkedBy.id)}) · ${e(s.linkedAt)}</p><p>출처는 고정되어 있으며 신고 본문은 별도입니다. 이 연결은 신고 제출·조치 완료·실제 안전을 의미하지 않습니다.</p></section>`;
}
export function printInspectionLinks(links: InspectionLink[]) {
  if (!links.length) return "";
  return `<section><h2>명시적으로 연결한 신고</h2>${links.map((l) => `<p>항목 ${e(l.snapshot.item.text)} → <a href="/api/sites/${e(l.site_id)}/hazards/${e(l.hazard_id)}/print">신고 ${e(l.hazard_id)}</a> · 현재 기록 상태 ${e(l.hazard_status)}</p>`).join("")}<p>연결 신고의 상태는 별도 기록이며 원 점검 결과를 자동 변경하거나 실제 안전을 인증하지 않습니다.</p></section>`;
}
