import type { OverviewSite } from "./manager-overview.js";
const due=(v:{beforeDate:number;onDate:number;afterDate:number})=>`기준일 전 ${v.beforeDate} / 당일 ${v.onDate} / 후 ${v.afterDate}`;
export function managerWorkflowLines(site:OverviewSite):string[] {
 const lines:string[]=[],w=site.workflow;
 if(w.documents.status==="unavailable")lines.push("문서/점검 집계 조회 불가 — 0건이 아닙니다.");
 else {const d=w.documents.value;lines.push(`작업계획 문서 검토 대기: 현재 마지막 ${d.workPlansSubmitted.currentLeaf} / 후속 있는 이전 ${d.workPlansSubmitted.priorWithSuccessor}`);for(const [key,label] of [["currentLeaf","현재 마지막"],["priorWithSuccessor","후속 있는 이전"]] as const){const i=d.inspections[key];lines.push(`점검 ${label}: 초안 ${i.draft} / 제출 ${i.submitted} / 수락 ${i.accepted} / 반려 ${i.returned}`);}}
 if(w.risk.status==="unavailable")lines.push("위험평가/조치 집계 조회 불가 — 0건이 아닙니다.");
 else for(const g of w.risk.value.groups){const name={product:"수치형",three_level:"3단계",checklist:"체크리스트",narrative:"서술형"}[g.method];for(const [key,label] of [["currentLeaf","현재 마지막"],["priorWithSuccessor","후속 있는 이전"]] as const){lines.push(`${name} ${label} 문서 제출 대기 ${g.documents[key].submitted}`);for(const [status,text] of [["assigned","배정"],["reported","보고"],["verified","확인"]] as const)lines.push(`${name} ${label} 조치 ${text}: ${due(g.actions[key][status])}`);}}
 if(w.meetingFollowups.status==="unavailable")lines.push("회의 후속 집계 조회 불가 — 0건이 아닙니다.");
 else for(const [key,label] of [["current","현재 원 회의"],["priorWithCorrection","정정본 있는 이전 회의"]] as const)for(const [status,text] of [["assigned","배정"],["reported","보고"],["verified","확인"]] as const)lines.push(`${label} 후속 ${text}: ${due(w.meetingFollowups.value[key][status])}`);
 if(!site.cost)lines.push("비용 월 미선택 — 비용을 조회하지 않았습니다.");
 else if(site.cost.status==="unavailable")lines.push("선택 월 비용 조회 불가 — 0원이 아닙니다.");
 else {const c=site.cost.value;if(c.kind==="no_period")lines.push(`${c.month} 비용 원장 없음 — 0원 지출로 추정하지 않습니다.`);else{lines.push(`${c.month} · ${c.state==="open"?"현재 미마감 원장":"현재 고정 마감본"} · 원장 ${c.id} v${c.version} · KRW 소수 6자리 정확 계산`);lines.push(`계획 ${c.totals.plan} / 초기 누계 ${c.totals.opening} / 당월 ${c.totals.current} / 누계 ${c.totals.cumulative} / 잔액 ${c.totals.remaining}`);if(c.closure)lines.push(`마감 ${c.closure.id} · SHA-256 ${c.closure.hash} · ${c.closure.closedAt}`);}}
 return lines;
}
