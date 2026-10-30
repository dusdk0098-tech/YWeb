import { escapeHtml as e } from "./print.js";
import type { NoticeView } from "./notice-model.js";
export function printNotice(v: NoticeView, manager: boolean) {
  const c = v.content;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${e(c.title)} · 현장 계정 공지</title><link rel="stylesheet" href="/print.css"></head><body><aside>인증된 현장 계정용 공지 · 브라우저 인쇄/PDF</aside><main><h1>${e(c.title)}</h1><p>${e(v.status)} · 공지 ${e(v.id)} v${v.version} · 게시본문 버전 ${v.publication?.publishedVersion || "미게시"}</p><p>적용일 표기 ${e(c.applyDate)} · ${e(c.workScope)}</p><p>${e(c.text)}</p>${v.publication ? `<p>${e(v.publication.site.name)} · 게시 계정 ${e(v.publication.publisher.name)} (${e(v.publication.publisher.id)}) · ${e(v.publication.publishedAt)}</p>` : ""}<h2>현재 로그인 계정의 확인</h2><p>${v.ownAck ? `${e(v.ownAck.name)} (${e(v.ownAck.user_id)}) · ${e(v.ownAck.at)} · 게시 버전 ${v.ownAck.published_version}` : "확인 기록 없음"}</p>${
    manager
      ? `<h2>현장 관리자 수신 대상/확인 현황</h2>${(v.targets || [])
          .map((t) => {
            const a = v.acknowledgements?.find((a) => a.user_id === t.user_id);
            return `<p>${e(t.name)} (${e(t.user_id)}) · ${a ? `계정 확인 ${e(a.at)}` : "미확인"}</p>`;
          })
          .join("")}`
      : ""
  }<footer>이 확인은 로그인 계정의 명시적 버튼 기록일 뿐 근로자 신원·실제 숙지·전자서명·안전 보증이 아닙니다. 외부 전송/알림 또는 적용일 예약 배포를 수행하지 않습니다. 철회/대체 후에는 새 확인을 받을 수 없습니다.</footer></main></body></html>`;
}
