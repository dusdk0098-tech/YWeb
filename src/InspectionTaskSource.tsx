import { useEffect, useState } from "react";
import { api } from "./api";
import type { TaskSource } from "../server/inspection-schedule-model";
export function InspectionTaskSource({
  siteId,
  id,
}: {
  siteId: string;
  id: string;
}) {
  const [source, setSource] = useState<TaskSource | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<TaskSource | null>(`/sites/${siteId}/inspections/${id}/task-source`)
      .then((v) => {
        if (active) {
          setSource(v);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [siteId, id]);
  if (error)
    return (
      <p role="alert" className="error">
        일정 출처 조회 실패: {error}
      </p>
    );
  if (!source) return null;
  return (
    <aside className="notice">
      <h3>시작 당시 일정 출처</h3>
      <p>
        {source.task.id} · 계획일 {source.task.body.plannedDate} ·{" "}
        {source.task.body.location}
      </p>
      <p>{source.task.body.instructions}</p>
      <p>
        당시 배정 {source.assignee.name} ({source.assignee.id}) · 시작{" "}
        {source.startedAt}
      </p>
      <p>
        계획일은 실제 수행일이 아닙니다. 초안의 날짜·점검자 표시를 직접
        확인하세요. 수락은 기록 검토이며 안전 인증이 아닙니다.
      </p>
    </aside>
  );
}
