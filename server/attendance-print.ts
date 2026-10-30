import { escapeHtml as e } from "./print.js";
import type { AttendanceRow } from "./attendance.js";
export function printAttendance(
  rows: AttendanceRow[],
  site: string,
  date: string,
  affiliation?: string,
) {
  const present = rows.filter((r) => r.status === "present").length;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(date)} 출역 현황</title><link rel="stylesheet" href="/print.css"></head><body><aside>브라우저 인쇄 / PDF 저장 · 담당자 수기 입력 현황</aside><main><h1>출역 현황</h1><p>${e(site)} · ${e(date)} · 소속: ${e(affiliation || "전체")}</p><p>출역 ${present}명 · 취소 ${rows.length - present}건 · 전체 ${rows.length}건</p><p>담당자 대리 입력입니다. 본인 확인·전자서명·교육/TBM 이수를 증명하지 않습니다. 공수/노임 산정용 확정 서식이 아닙니다.</p>${rows.map((r) => `<article><h2>${e(r.name)} · ${e(r.affiliation)}</h2><p>${r.kind === "worker" ? "근로자" : "방문자"} · ${r.status === "present" ? "출역" : "취소"} · 버전 ${r.version}</p><p>사유: ${e(r.reason)}<br>기록 ID: ${e(r.id)}<br>입력 방식: 담당자 수기 · 최근 변경: ${e(r.updated_at)}</p></article>`).join("")}<footer>이름·소속·구분은 최초 출역 등록 당시 명부값입니다. 날짜/대상 오류는 기존 기록 취소 후 올바른 기록을 새로 등록합니다.</footer></main></body></html>`;
}
