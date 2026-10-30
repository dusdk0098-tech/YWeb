import { RiskJsonDownload } from "./RiskJsonDownload";
import { useState } from "react";
import { api, type Site } from "./api";
import type { RiskDocumentReport } from "../server/risk-document-report";
type PrintContext = Pick<
  RiskDocumentReport,
  "fingerprint" | "generatedAt" | "document" | "counts"
>;
export function RiskPrintControl({
  site,
  assessmentId,
  disabled,
  onBusyChange,
}: {
  site: Site;
  assessmentId: string;
  disabled: boolean;
  onBusyChange: (v: boolean) => void;
}) {
  const [context, setContext] = useState<PrintContext | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function prepare() {
    setBusy(true);
    onBusyChange(true);
    setContext(null);
    setError("");
    try {
      setContext(
        await api<PrintContext>(
          `/sites/${site.id}/risk-assessments/${assessmentId}/print-context`,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <section>
      <h3>고정 원문 출력: HTML / JSON</h3>
      <p>
        원 제출본과 조회 시점 조치/재평가를 별도 표시합니다. 전체 변경 이력 또는
        법정 승인 문서가 아닙니다. 실제 브라우저/PDF 페이지 검증 미완료.
      </p>
      {error && <p role="alert">{error}</p>}
      <button disabled={disabled || busy} onClick={prepare}>
        현재 조회로 HTML/JSON 준비
      </button>
      {context && !disabled && !busy && (
        <>
          <p>
            조회 UTC {context.generatedAt} / 위험행 {context.counts.hazards} /
            원 계획 {context.counts.plans} / 현재 조치 {context.counts.actions}{" "}
            / 최신 종류별 재평가 {context.counts.latestResiduals} (전체 재평가
            이력 {context.counts.allResidualHistoryRecords})
          </p>
          <RiskJsonDownload siteId={site.id} assessmentId={assessmentId} fingerprint={context.fingerprint} />
          <a
            href={`/api/sites/${site.id}/risk-assessments/${assessmentId}/print?expectedFingerprint=${context.fingerprint}`}
            target="_blank"
            rel="noreferrer"
          >
            준비한 조회의 인쇄용 HTML 열기
          </a>
          <p>
            열기 전 원문 상태/현재 조치/재평가가 바뀌면409로 중단합니다. 다시
            준비하세요. 이미 열린 파일을 원격 갱신하지 않습니다.
          </p>
        </>
      )}
    </section>
  );
}
