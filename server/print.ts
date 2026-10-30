import type { MeetingInput } from "./validation.js";
export const escapeHtml = (v: unknown) =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function printMeeting(
  m: MeetingInput & { version: number; updatedAt: string },
  site: string,
  author: string,
) {
  const section = (title: string, value: string) =>
    `<section><h2>${title}</h2><p>${escapeHtml(value) || "—"}</p></section>`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(m.title)} · 회의록</title><link rel="stylesheet" href="/print.css"></head><body><aside>브라우저 인쇄(Ctrl/Cmd + P) → PDF로 저장 가능 · 업무 초안, 서명/결재 아님</aside><main><header><p>PEDIT · ${escapeHtml(site)}</p><h1>${escapeHtml(m.title)}</h1><p>${escapeHtml(m.type)} · ${escapeHtml(m.date)} ${escapeHtml(m.time)} · ${escapeHtml(m.location)}</p><p>작성자: ${escapeHtml(author)} · 버전 ${m.version} · 수정 ${escapeHtml(m.updatedAt)}</p></header>${section("참석자 · 소속 · 역할", m.attendees)}${section("안건", m.agenda)}${section("논의 내용", m.discussion)}${section("결정 사항", m.decisions)}<section><h2>후속 조치</h2>${m.actions.length ? m.actions.map((a) => `<article><h3>${escapeHtml(a.task)}</h3><p>담당: ${escapeHtml(a.owner)} · 기한: ${escapeHtml(a.due)} · 상태: ${escapeHtml(a.status)}</p></article>`).join("") : "<p>—</p>"}</section><footer>초안 회의록 · 참석자 등록은 본인 서명/교육 이수를 뜻하지 않습니다. 첨부·전자서명·승인 미지원.</footer></main></body></html>`;
}
