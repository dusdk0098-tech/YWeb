import { printInspectionSource } from "./inspection-link-print.js";
import type { InspectionLink } from "./inspection-links.js";
import { escapeHtml as e } from "./print.js";
import type {
  HazardRow,
  HazardEvent,
  HazardStatus,
  HazardOriginal,
} from "./hazards.js";
import type { HazardInput } from "./hazard-validation.js";
export const hazardStatusLabel = (s: HazardStatus) =>
  ({
    draft: "초안",
    reported: "신고 제출",
    assigned: "담당자 배정",
    review_requested: "검토 요청",
    closed: "기록상 종결",
  })[s];
export function printHazard(
  row: HazardRow,
  events: HazardEvent[],
  source: InspectionLink | null = null,
) {
  const r = { ...row, body: JSON.parse(row.body) as HazardInput },
    original = row.submitted_snapshot
      ? (JSON.parse(row.submitted_snapshot) as HazardOriginal)
      : null;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(r.body.title)} · 신고/조치 기록</title><link rel="stylesheet" href="/print.css"></head><body><aside>브라우저 인쇄 / PDF 저장 · 현재 상태와 전체 사건 기록</aside><main><h1>${e(r.body.title)}</h1><p>기록 ID ${e(r.id)} · ${hazardStatusLabel(r.status)} · 버전 ${r.version}</p><p>위험요소에 관한 텍스트 신고/조치 기록입니다. 기록상 종결은 실제 위험 제거·작업 안전을 보증하지 않습니다. 위험 점수/등급 평가는 지원하지 않습니다. 첨부 원본은 악성코드/내부 이미지 형식 미검사(UNSCANNED)이며 인쇄에 포함하지 않습니다.</p><h2>${original ? "제출 당시 원문" : "저장된 초안"}</h2>${original ? `<p>${e(original.site.name)} · 신고 계정 ${e(original.reporter.name)} (${e(original.reporter.id)}) · ${e(original.submittedAt)}</p>` : ""}<p>관찰일: ${e(r.body.observedDate)} · 장소 설명: ${e(r.body.location)}</p><p>${e(r.body.description)}</p>${original?.attachments ? `<h2>제출 당시 첨부 목록 (원본 미검사)</h2>${original.attachments.map((a) => `<p>${e(a.filename)} · ${a.size} bytes · SHA-256 ${e(a.sha256)} · ID ${e(a.id)}</p>`).join("")}` : ""}${printInspectionSource(source)}<h2>현재 조치 정보</h2><p>담당 계정 ID: ${e(r.assignee_id || "미배정")} · 기한: ${e(r.due_date || "—")}</p><p>${e(r.remediation || "현재 단계에 제출된 조치 내용 없음")}</p><h2>시간순 변경 기록</h2>${events
    .map((v) => {
      const state = JSON.parse(v.snapshot) as {
        assignee_id: string | null;
        due_date: string | null;
        remediation: string;
        body: HazardInput;
      };
      return `<article><h3>v${v.version} · ${e(v.event)} · ${v.from_status ? hazardStatusLabel(v.from_status) : "생성"} → ${hazardStatusLabel(v.to_status)}</h3><p>${e(v.actor_name)} (계정 ID ${e(v.actor_id)}) · ${e(v.at)}</p><p>사유: ${e(v.note)}</p><p>담당 계정 ID: ${e(state.assignee_id || "미배정")} · 기한: ${e(state.due_date || "—")}</p>${state.remediation ? `<p>조치 내용: ${e(state.remediation)}</p>` : ""}${["created", "draft_updated", "submitted"].includes(v.event) ? `<p>당시 신고 내용: ${e(state.body.title)} · ${e(state.body.observedDate)} · ${e(state.body.location)}<br>${e(state.body.description)}</p>` : ""}</article>`;
    })
    .join(
      "",
    )}<footer>담당자 조치와 관리자 기록 검토를 분리하는 잠정 업무 정책입니다. 법적 승인/안전 인증이 아닙니다. 첨부 목록/해시는 파일의 진위·안전·법적 증거 적합성을 인증하지 않습니다.</footer></main></body></html>`;
}
