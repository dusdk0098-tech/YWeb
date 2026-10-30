import { narrativeQuestionLabels, type NarrativeQuestionKey } from "../../server/risk-narrative-labels.js";
import type { RiskDocumentReport } from "../../server/risk-document-report.js";
import { escapeHtml as e } from "../../server/print.js";
const field = (label: string, value: unknown) =>
  `<p><strong>${e(label)}:</strong> ${value === null || value === undefined || value === "" ? "미기록" : e(value)}</p>`;
const status = {
  draft: "초안",
  submitted: "문서 검토 대기",
  accepted: "문서 기록 수락 (실제 위험 허용 아님)",
  returned: "문서 보완 요청",
};
const actionStatus = {
  assigned: "배정·보고 대기",
  reported: "담당자 보고 기록",
  verified: "다른 관리자의 확인 기록 (소프트웨어 관측 아님)",
};
// Freeze the old renderer's supported residual union, without altering its output.
type LegacyReport=Omit<RiskDocumentReport,"residuals"> & {residuals:Extract<RiskDocumentReport["residuals"][number],{method:"product"|"three_level"}>[]};
export function printLegacyRiskDocument(report: RiskDocumentReport) {
  if(report.residuals.some(v=>v.method!=="product"&&v.method!=="three_level"))throw new Error("Legacy fixture supports old residual methods only");
  const r=report as LegacyReport;
  const s = r.submission,
    c = s.criteria.body;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(s.body.title)} · 위험성평가 기록</title><link rel="stylesheet" href="/print.css"></head><body>
<main>
<header><h1>${e(s.body.title)}</h1>${field("현장 이름 (현재 조회)", r.site.name)}
${field("문서 ID", r.document.id)}
${field("현재 문서 상태", status[r.document.status])}
${field("현재 버전 / 원 제출 버전", `${r.document.currentVersion} / ${s.version}`)}
${field("출력 조회 UTC", r.generatedAt)}
${field("조회 fingerprint", r.fingerprint)}<p>미검증 개발본. 독립 보안·실제 브라우저/PDF 검증 미완료. 문서 수락·점수·사람 확인 기록은 실제 안전/법정 적합성/작업 재개 허가가 아닙니다. 광고·서명·본인확인 문서가 아닙니다.</p>${r.document.successorId ? `<p>후속 문서 존재: ${e(r.document.successorId)} / ${e(r.document.successorStatus)}. 이 인쇄는 이전 원문이며 자동으로 최신본을 대신하지 않습니다.</p>` : "<p>현재 조회에서 직접 후속 문서 없음. 실물 최신성을 보증하지 않습니다.</p>"}</header>
${r.reuseSource ? `<section><h2>독립 재사용 출처 (정정 관계 아님)</h2>${field("원 문서 / 제출 버전", `${r.reuseSource.sourceId} / ${r.reuseSource.sourceSubmissionVersion}`)}${field("원 제출 hash", r.reuseSource.sourceSubmissionHash)}${field("당시 기준 ID / 버전", `${r.reuseSource.criteriaId} / ${r.reuseSource.criteriaVersion}`)}${field("당시 기준 hash", r.reuseSource.criteriaHash)}${field("재사용 계정 / UTC", `${r.reuseSource.actor.name} / ${r.reuseSource.at}`)}${field("사유", r.reuseSource.reason)}${field("계획 내용 포함", r.reuseSource.includePlans ? "예" : "아니오")}<p>생성 당시 판단·판단근거와 계획 담당·예정일·우선순위를 초기화했습니다. 과거 설명은 현장 재확인이 필요합니다. 승인·실행·확인·재평가·의견·게시 기록을 상속하지 않았습니다.</p>${r.reuseSource.mapping.map(m => field("원 위험행 → 생성 위험행", `${m.sourceHazardId} → ${m.newHazardId}`)).join("")}</section>` : ""}
 <section><h2>1. 고정 제출 원문 (이후 정보를 덧씌우지 않음)</h2>${field("원 작성 계정", `${s.author.name} / ${s.author.id}`)}
${field("제출 기록 UTC", s.at)}
${field("원 제출 hash", r.document.submissionHash)}
${field("평가일", s.body.date)}
${field("시기 / 방법", `${s.body.timing} / ${s.body.method === "product" ? "가능성×중대성 수치형" : s.body.method === "three_level" ? "사람 선택 3단계 판단 (숫자 변환 없음)" : s.body.method === "narrative" ? "핵심요인 서술형 (점수/전체 안전 판정 없음)" : "체크리스트 항목별 사람 판단 (점수/전체 안전 판정 없음)"}`)}
${field("계기", s.body.trigger)}
${field("작업 범위", s.body.workScope)}
 <h3>고정된 사람 정의 기준</h3>${field("기준 ID / 버전", `${s.criteria.id} / ${s.criteria.version}`)}
${field("기준 이름", c.name)}
${field("기준 근거", c.rationale)}
${
  c.method === "product"
    ? `${c.likelihood.map((x, i) => field(`가능성 ${i + 1}`, x)).join("")}
${c.severity.map((x, i) => field(`중대성 ${i + 1}`, x)).join("")}
${c.bands.map((b) => field(`설정 구간 ${b.min}–${b.max}`, `${b.label}; 사용자 기준상 ${b.criterionAcceptable ? "허용 분류" : "비허용 분류"} (안전 허가 아님)`)).join("")}
`
    : c.method === "narrative"
      ? Object.entries(c.questions).map(([key, q]) => field(`고정 핵심 질문 · ${narrativeQuestionLabels[key as NarrativeQuestionKey]}`, `${q.prompt}; 작성 안내: ${q.guidance}`)).join("")
    : c.method === "checklist"
      ? c.items
          .map((i) =>
            field(
              `고정 체크항목 ${i.id}`,
              `${i.prompt}; 판단 안내: ${i.guidance}`,
            ),
          )
          .join("")
      : c.levels
          .map((l) =>
            field(
              `사용자 단계 ${l.label}`,
              `${l.description}; 사용자 기준상 ${l.criterionAcceptable ? "허용" : "비허용"} 분류 (안전 허가 아님)`,
            ),
          )
          .join("")
}
 ${s.body.hazards
   .map((h, i) => {
     const result = s.results.find((x) => x.id === h.id)!;
     const item = c.method === "checklist" && "checklistItemId" in h
       ? c.items.find((item) => item.id === h.checklistItemId)
       : null;
     return `<section><h3>위험행 ${i + 1} · ${e(h.id)}</h3>${field("세부 작업", h.task)}
${field("위치", h.location)}
${field("분류 / 사고 형태", `${h.category || "미기록"} / ${h.accidentType || "미기록"}`)}
${c.method === "narrative" ? "" : field("발생 상황", h.scenario)}
${c.method === "narrative" ? "" : field("예상 피해 / 노출 집단", `${h.harm} / ${h.exposedGroup || "미기록"}`)}
${field("관련 근거", h.reference)}
${c.method === "narrative" ? "" : field("원 현재 조치", h.currentControls)}
${item ? field("이 응답의 고정 질문", item.prompt) + field("이 응답의 고정 판단 안내", item.guidance) : ""}
${c.method === "narrative" && "exposurePath" in h ? Object.entries(c.questions).map(([key, q]) => {
  const answer = h[key === "additionalMeasures" ? "judgmentReason" : key as Exclude<NarrativeQuestionKey, "additionalMeasures">];
  return field(`고정 질문: ${q.prompt}`, answer) + field("작성 안내", q.guidance);
}).join("") : ""}
${c.method === "narrative" ? "" : field("원 판단 근거", h.judgmentReason)}
${field("likelihood" in h ? "원 산술값" : "levelId" in h ? "사람이 선택한 단계 (점수 변환 없음)" : "exposurePath" in h ? "서술형 사람 판단 (전체 안전 판정 아님)" : "항목별 사람 응답 (전체 안전 판정 아님)", "likelihood" in h ? `${h.likelihood} × ${h.severity} = ${result.score}; ${result.bandLabel}; 사용자 기준상 ${result.criterionAcceptable ? "허용" : "비허용"} 분류 (실제 안전 판정 아님)` : "checklistItemId" in h ? `항목ID ${h.checklistItemId}; ${result.bandLabel}; 전체 위험 허용 판정 없음` : "exposurePath" in h ? `${result.bandLabel}; 점수/전체 위험 허용 판정 없음` : `${result.bandLabel}; 사용자 기준상 ${result.criterionAcceptable ? "허용" : "비허용"} 분류 (실제 안전 판정 아님)`)}
${
  h.plans.length
    ? h.plans
        .map(
          (p, j) => `<h4>원 저감 계획 ${j + 1}</h4>${field("내용", p.action)}
${field("통제 유형", p.controlType)}
${field("원 담당 메모 (계정 배정 아님)", p.ownerNote)}
${field("원 예정일", p.due)}
${field("우선순위 / 실행 전 조건", `${p.priorityNote || "미기록"} / ${p.preconditions || "미기록"}`)}`,
        )
        .join("")
    : "<p>원 계획0개. 실제 저감 완료나 계획 불필요를 자동 판단하지 않습니다.</p>"
}</section>`;
   })
   .join("")}</section>
 <section><h2>2. 현재 문서 결정 (원문과 별도)</h2>${r.document.decision ? field("결정", `${r.document.decision.kind} / ${r.document.decision.actor.name} (${r.document.decision.actor.id}) / ${r.document.decision.at}`) + field("결정 사유", r.document.decision.reason) : "<p>문서 결정 미기록 · 검토 대기. 수락으로 간주하지 않습니다.</p>"}</section>
 <section><h2>3. 조회 시점의 조치 현황 (원 계획을 변경하지 않음)</h2><p>현재 연결 조치 ${r.actions.length}개. 모든 내용 있는 원 계획마다 미연결 여부를 아래에 표시합니다. 확인은 이름 있는 사람의 기록이지 소프트웨어의 실물 관측이 아닙니다.</p>${s.body.hazards
   .map((h, i) =>
     h.plans
       .map((p, j) => {
         if (!p.action.trim())
           return `<p>위험행${i + 1} 계획${j + 1}: 원 계획 내용 미기록. 조치 완료로 간주하지 않음.</p>`;
         const a = r.actions.find(
           (x) => x.hazardId === h.id && x.planIndex === j,
         );
         if (!a)
           return `<p>위험행${i + 1} 계획${j + 1}: 조치 기록 미연결 (실제 미이행 여부 불명).</p>`;
         return `<section><h3>위험행${i + 1} 계획${j + 1} / ${e(a.id)}</h3>${field("상태 / 버전", `${actionStatus[a.status]} / ${a.version}`)}
${field("현재 담당 / 예정일", `${a.assignee.name} (${a.assignee.id}) / ${a.due}`)}
${field("원 출처 hash", a.sourceHash)}
${a.report ? field("담당 보고", a.report.text) + field("주장 이행일 / 서버UTC / 보고자", `${a.report.claimedLocalDate} / ${a.report.recordedAt} / ${a.report.actor.name} (${a.report.actor.id})`) : "<p>현재 보고 미기록/초기화됨. 과거 사건 여부는 별도 이력을 조회하세요.</p>"}
${a.verification ? field("사람 확인 의견", a.verification.note) + field("주장 확인일 / 서버UTC / 확인자", `${a.verification.claimedLocalDate} / ${a.verification.recordedAt} / ${a.verification.actor.name} (${a.verification.actor.id})`) + field("확인 대상 보고 hash", a.verification.reportHash) : "<p>현재 사람 확인 기록 없음. 검증 완료로 간주하지 않음.</p>"}</section>`;
       })
       .join(""),
   )
   .join("")}</section>
 <section><h2>4. 위험행별 종류별 최신 재평가 요약</h2><p>전체 이력 ${r.counts.allResidualHistoryRecords}개 중 각 위험행/종류의 최신 버전 ${r.residuals.length}개만 표시합니다. 이전 버전 전체 이력 인쇄가 아닙니다. 예상과 조치 확인 후 입력을 자동 동일시하지 않습니다.</p>${
   (s.body.method === "checklist" || s.body.method === "narrative")
     ? "<p>이 비수치 방법 전용 재평가 기록은 미지원입니다. 수치 재평가로 변환하지 않습니다.</p>"
     : s.body.hazards
         .map((h, i) =>
           (["projected", "after_confirmation"] as const)
             .map((kind) => {
               const v = r.residuals.find(
                   (x) => x.hazardId === h.id && x.kind === kind,
                 ),
                 label =
                   kind === "projected"
                     ? "계획상 예상"
                     : "조치 확인 후 입력한 재평가";
               if (!v)
                 return `<p>위험행${i + 1} ${label}: 기록 없음 (0점/안전/완료가 아님).</p>`;
               return `<section><h3>위험행${i + 1} ${label} / v${v.version}</h3>${field("기록 ID", v.id)}
${field("참조 상태", v.stale ? "참조 변경됨: 과거 기록을 최신 판단처럼 사용하지 마세요." : "현재 조회 참조와 같음 (실물 최신성 보증 아님)")}
${field(v.method === "three_level" ? "사람이 선택한 재평가 단계 (숫자 점수 없음)" : "산술 결과", `${v.method === "three_level" ? v.result.bandLabel : `${v.likelihood} × ${v.severity} = ${v.result.score}; ${v.result.bandLabel}`}; ${v.result.criterionAcceptable ? "사용자 기준상 허용 분류 (안전 허가 아님)" : "사용자 기준상 비허용 분류 · 추가 검토 필요"}`)}
${v.method === "three_level" && "description" in v.result ? field("당시 단계 판단 안내", v.result.description) + field("당시 선택 단계 ID", v.levelId) : ""}
${field("근거", v.basis)}
${field("주장 현장일 / 서버UTC / 입력자", `${v.claimedLocalDate} / ${v.recordedAt} / ${v.actor.name} (${v.actor.id})`)}
${field("사유", v.reason)}
${field("당시 참조 fingerprint", v.contextFingerprint)}
${v.actionRefs.map((a) => field(`당시 계획${a.planIndex + 1} 조치 참조`, `${a.id ?? "미연결"} / v${a.version ?? "없음"} / ${a.status ?? "미기록"} / 보고hash ${a.reportHash ?? "없음"} / 확인hash ${a.verificationHash ?? "없음"}`)).join("")}</section>`;
             })
             .join(""),
         )
         .join("")
 }</section><footer><p>한 시점의 일관된 DB 조회. 고정 원문과 현재 부가 기록은 구분했습니다. 독립 보안/실제 브라우저 인쇄/PDF 페이지 검증 미완료. 서명·법정 인증·실제 작업 승인 문서가 아닙니다.</p></footer></main></body></html>`;
}
