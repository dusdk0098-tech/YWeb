import { catalogProvenanceHtml } from "./education-catalog-print.js";
import type { CatalogProvenance } from "./education-catalog-source.js";
import { escapeHtml as e } from "./print.js";
import {
  scheduledMinutes,
  type EducationInput,
} from "./education-validation.js";
import type { EducationParticipant, EducationSnapshot } from "./education.js";
export function printEducation(
  draft: {
    id: string;
    site: string;
    details: EducationInput;
    participants: EducationParticipant[];
    version: number;
    catalogSource?: CatalogProvenance | null;
  },
  snapshot: { body: EducationSnapshot; hash: string } | null,
) {
  const d = snapshot?.body.details || draft.details,
    people = snapshot?.body.participants || draft.participants;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(d.title)} · 수기 교육일지</title><link rel="stylesheet" href="/print.css"></head><body><aside>브라우저 인쇄 / PDF 저장 · ${snapshot ? "관리자 기록 보관 확정" : "저장된 초안"}</aside><main><h1>${e(d.title)}</h1><p>${e(snapshot?.body.site.name || draft.site)} · 자체 과정표시: ${e(d.courseLabel)}</p><p>${e(d.date)} ${e(d.startTime)}–${e(d.endTime)} (같은 날 현지 시각 표기) · 휴게 ${d.breakMinutes}분 · 예정 ${snapshot?.body.scheduledMinutes ?? scheduledMinutes(d)}분</p><p>장소 ${e(d.location)} · 강사 표시(직접 입력) ${e(d.instructor)}</p><p>예정시간은 입력 시각의 분 차이이며 시간대/DST를 보정한 실제 경과시간이 아닙니다. 개인 참여시간은 담당자가 따로 수기 입력한 값입니다. 출역/TBM을 자동 승계하지 않습니다. 본인 확인·서명·법정 교육 이수증/안전 인증이 아닙니다.</p><h2>목표</h2><p>${e(d.objectives)}</p><h2>직접 작성 교육내용</h2><p>${e(d.contents)}</p>${catalogProvenanceHtml(snapshot ? snapshot.body.catalogSource : draft.catalogSource)}<h2>수기 참여 기록</h2>${people.map((p) => `<article><h3>${e(p.name)} · ${e(p.affiliation)}</h3><p>${{ pending: "미입력", attended: "담당자 기록 · 참석", absent: "담당자 기록 · 불참" }[p.state]} · 수기 참여 ${p.attended_minutes}분</p><p>명부 ID ${e(p.worker_id)} · 기록 계정 ${e(p.recorded_by || "—")} · ${e(p.recorded_at || "—")}</p></article>`).join("")}${snapshot ? `<footer><p>기록 ${e(snapshot.body.id)} v${snapshot.body.version} · 원 작성 계정 ${e(snapshot.body.author.name)} (${e(snapshot.body.author.id)})</p><p>관리자 보관 확정 ${e(snapshot.body.archivedBy.name)} (${e(snapshot.body.archivedBy.id)}) · ${e(snapshot.body.archivedAt)}</p><p>이전 보관본 ${e(snapshot.body.parentId || "없음")} · 정정 사유 ${e(snapshot.body.revisionReason || "최초 기록")}</p><p>내용 SHA-256 ${e(snapshot.hash)} (내용 비교용, 전자서명 아님)</p></footer>` : "<footer>미보관 초안 · 변경될 수 있습니다.</footer>"}</main></body></html>`;
}
