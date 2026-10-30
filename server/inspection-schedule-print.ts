import { escapeHtml as e } from "./print.js";
import type {
  TaskSource,
  taskRecord,
  taskChain,
} from "./inspection-schedule-model.js";
export function printTaskSource(source: TaskSource | null) {
  if (!source) return "";
  const t = source.task;
  return `<section><h2>시작 당시 점검 일정 출처</h2><p>일정 ${e(t.id)} v${t.version} · 계획일 ${e(t.body.plannedDate)} · ${e(t.body.location)}</p><p>${e(t.body.instructions)}</p><p>배정 계정 ${e(source.assignee.name)} (${e(source.assignee.id)}) · 시작 계정 ${e(source.startedBy.name)} (${e(source.startedBy.id)}) · ${e(source.startedAt)}</p><p>계획일은 실제 수행일/안전 인증이 아닙니다.</p></section>`;
}
export function printInspectionTask(
  task: ReturnType<typeof taskRecord>,
  chain: ReturnType<typeof taskChain>,
  events: {
    event: string;
    reason: string;
    actor_name: string;
    at: string;
    version: number;
    actor_id: string;
    snapshot: string;
  }[],
) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>점검 일정</title><link rel="stylesheet" href="/print.css"></head><body><main><h1>자체 점검 일정</h1><p>${e(task.id)} · ${e(task.status)} · v${task.version}</p><p>계획일 ${e(task.body.plannedDate)} · ${e(task.body.location)}</p><p>${e(task.body.instructions)}</p><p>고정 양식 ${e(task.template_snapshot.body.title)} · ${e(task.template_id)} v${task.template_snapshot.version}</p><p>배정 계정ID ${e(task.assignee_id)}</p><h2>실제 점검 기록 상태</h2>${chain.items.map((i) => `<p>${e(i.id)} · ${e(i.status)} · v${i.version} · 작성계정 ${e(i.owner_id)}</p>`).join("")}${chain.hasMore ? "<p>연결100건 초과: 최신 상태 판정 보류. 개별 점검에서 후속 기록을 확인하세요.</p>" : ""}<h2>일정 변경 기록</h2>${events
    .map((v) => {
      const old = JSON.parse(v.snapshot) as ReturnType<typeof taskRecord>;
      return `<article><p>v${v.version} ${e(v.event)} · ${e(v.actor_name)} (${e(v.actor_id)}) · ${e(v.at)}<br>${e(v.reason)}</p><p>당시 계획 ${e(old.body.plannedDate)} · ${e(old.body.location)} · 배정 ${e(old.assignee_id)}</p><p>${e(old.body.instructions)}</p></article>`;
    })
    .join(
      "",
    )}<footer>일정은 수기 계획입니다. 자동 실행/완료·법적 준수·실제 안전 인증이 아닙니다. 취소는 앱 기록만 바꾸며 외부 작업을 취소하지 않습니다.</footer></main></body></html>`;
}
