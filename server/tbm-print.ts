import type { TbmRiskReference } from "./tbm-risk-reference.js";
import { escapeHtml as e } from "./print.js";
import type { TbmInput } from "./tbm-validation.js";
import type { TbmParticipant, TbmSnapshot } from "./tbm.js";
export function printTbm(
  draft: {
    id: string;
    site: string;
    details: TbmInput;
    participants: TbmParticipant[];
    version: number;
    riskReference?: TbmRiskReference | null;
  },
  snapshot: { body: TbmSnapshot; hash: string } | null,
) {
  const d = snapshot?.body.details || draft.details,
    people = snapshot?.body.participants || draft.participants,
    site = snapshot?.body.site.name || draft.site;
  const ref = snapshot ? (snapshot.body.schemaVersion === 2 ? snapshot.body.riskReference?.reference : null) : draft.riskReference;
  const risk = ref ? `<section><h2>고정 위험성평가 출처</h2><p>${e(ref.title)} · ${e(ref.date)} · 방법 ${e(ref.method)}</p><p>평가 ID ${e(ref.assessmentId)} · 제출 버전 ${ref.submissionVersion} · SHA-256 ${e(ref.submissionHash)}</p><p>선택 위험행 설명만 제공합니다. 전체 평가를 대신하지 않으며 전달·참여·서명·이해·안전 허가를 증명하지 않습니다.</p>${snapshot?.body.schemaVersion === 2 && snapshot.body.riskReference?.sourceHasSuccessorAtFinalization ? "<p>확정 당시 후속 평가가 있는 고정 출처 사용을 관리자가 확인했습니다.</p>" : ""}${ref.hazards.map(h=>`<article><h3>${e(h.task)} · ${e(h.location)}</h3><p>위험행 ID ${e(h.id)}</p><p>위험 상황: ${e(h.scenario)}</p><p>예상 피해: ${e(h.harm)}</p><p>평가 제출 당시 현재 조치: ${e(h.currentControls)}</p></article>`).join("")}</section>` : "";
  const state = (v: TbmParticipant["state"]) =>
    ({
      pending: "미확인",
      present: "담당자 기록 · 참여",
      absent: "담당자 기록 · 불참",
    })[v];
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(d.title)} · TBM</title><link rel="stylesheet" href="/print.css"></head><body><aside>브라우저 인쇄 / PDF 저장 · ${snapshot ? "관리자가 확정한 기록" : "저장된 초안"}</aside><main><h1>${e(d.title)}</h1><p>TBM · ${e(site)} · ${e(d.date)} ${e(d.time)} · ${e(d.location)}</p><p>진행자(입력): ${e(d.facilitator)} · ${snapshot ? "관리자가 기록을 확정" : "초안"} · 버전 ${snapshot?.body.version || draft.version}</p><p>담당자가 참여 사실을 수기로 기록했습니다. 대상자 본인 확인·전자서명·법정 교육 이수 증명이 아닙니다.</p><h2>당일 작업</h2><p>${e(d.work)}</p><h2>안전 전달사항</h2><p>${e(d.topics)}</p>${risk}<h2>참가 대상 기록</h2>${people.map((p) => `<article><h3>${e(p.name)} · ${e(p.affiliation)}</h3><p>${p.kind === "worker" ? "근로자" : "방문자"} · ${state(p.state)}<br>기록 계정 ID: ${e(p.recorded_by || "—")} · 시각: ${e(p.recorded_at || "—")}<br>명부 ID: ${e(p.worker_id)}</p></article>`).join("")}${snapshot ? `<footer><p>관리자 기록 확정: ${e(snapshot.body.finalizedBy.name)} (계정 ID ${e(snapshot.body.finalizedBy.id)}) · ${e(snapshot.body.finalizedAt)}</p><p>정정 사유: ${e(snapshot.body.revisionReason || "최초 기록")} · 이전 확정본 ID: ${e(snapshot.body.parentId || "없음")}</p><p>내용 SHA-256: ${e(snapshot.hash)} (내용 비교용, 전자서명/법적 인증 아님)</p></footer>` : "<footer>미확정 초안 · 수정될 수 있습니다.</footer>"}</main></body></html>`;
}
