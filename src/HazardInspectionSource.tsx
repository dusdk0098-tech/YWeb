import { useEffect, useState } from "react";
import { api } from "./api";
import type { InspectionLink } from "../server/inspection-links";
export function HazardInspectionSource({
  siteId,
  id,
}: {
  siteId: string;
  id: string;
}) {
  const [source, setSource] = useState<InspectionLink | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    api<InspectionLink | null>(
      `/sites/${siteId}/hazards/${id}/inspection-source`,
    )
      .then((v) => {
        if (active) setSource(v);
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
        점검 출처 조회 실패: {error}
      </p>
    );
  if (!source) return null;
  const s = source.snapshot;
  return (
    <section className="notice">
      <h2>불변 점검 출처</h2>
      <p>
        {s.templateTitle} · 양식 {s.templateId} v{s.templateVersion}
      </p>
      <p>
        원 점검 {s.inspectionId} v{s.inspectionVersion} · {s.date} ·{" "}
        {s.location}
      </p>
      <p>부적합 항목: {s.item.text}</p>
      <p>원 설명: {s.item.comment}</p>
      <p>
        원 제출 계정 {s.submitter.name} ({s.submitter.id}) · {s.submittedAt}
      </p>
      <p>
        연결 계정 {s.linkedBy.name} ({s.linkedBy.id}) · {s.linkedAt}
      </p>
      <a
        href={`/api/sites/${siteId}/inspections/${s.inspectionId}/print`}
        target="_blank"
        rel="noreferrer"
      >
        원 점검 저장본 보기 / 인쇄
      </a>
      <p>
        출처와 신고 본문은 별도입니다. 본문을 수정해도 이 출처는 바뀌지
        않습니다. 연결은 실제 안전이나 자동 조치 완료를 보증하지 않습니다.
      </p>
    </section>
  );
}
