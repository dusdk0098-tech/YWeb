import { useState } from "react";
import { api, type Site, type User } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import { WorkPlanPicker } from "./WorkPlanPicker";
import type { RiskAssessmentRecord } from "../server/risk-core";
export const riskStatus = {
  draft: "초안",
  submitted: "문서 검토 대기",
  accepted: "문서 기록 수락 (안전 허가 아님)",
  returned: "문서 보완 요청 · 후속 초안",
};
export function RiskReviewActions({
  site,
  user,
  row,
  onAdopt,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  user: User;
  row: RiskAssessmentRecord;
  onAdopt: (v: RiskAssessmentRecord) => void;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [reason, setReason] = useState(""),
    [authorId, setAuthorId] = useState(row.author_id),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const guard = useDraftGuard(
      !!reason || confirm || authorId !== row.author_id,
      busy,
      onDirtyChange,
      onBusyChange,
    ),
    manager = site.role === "manager",
    own = row.author_id === user.id;
  async function send(action: "submit" | "accepted" | "returned" | "revise") {
    const path = `/sites/${site.id}/risk-assessments/${row.id}/${action === "accepted" || action === "returned" ? "review" : action}`,
      value =
        action === "submit"
          ? { version: row.version, reason, confirmRecordOnly: confirm }
          : action === "revise"
            ? { version: row.version, reason, authorId }
            : {
                version: row.version,
                reason,
                decision: action,
                confirmRecordOnly: confirm,
                ...(action === "returned" ? { authorId } : {}),
              };
    setBusy(true);
    setError("");
    try {
      const next = await api<
        | RiskAssessmentRecord
        | {
            record: RiskAssessmentRecord;
            nextDraft: RiskAssessmentRecord | null;
          }
      >(path, "POST", value, guard.key(path, value));
      setReason("");
      setConfirm(false);
      onAdopt("record" in next ? (next.nextDraft ?? next.record) : next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const maySubmit = row.status === "draft" && own && site.role !== "viewer",
    mayReview = row.status === "submitted" && manager && !own,
    mayRevise = row.status === "accepted" && manager && !row.successor_id;
  if (!maySubmit && !mayReview && !mayRevise)
    return (
      <p>
        {row.status === "submitted" && own
          ? "작성자와 다른 현장 관리자가 문서를 검토해야 합니다. 관리자가 부족해도 자기 수락으로 우회하지 않습니다."
          : "현재 계정/상태에서 문서 전이 작업이 없습니다."}
      </p>
    );
  return (
    <section>
      <h3>문서 기록 처리</h3>
      <p>
        문서 수락은 실제 위험을 허용하거나 작업 재개를 승인하는 행위가 아닙니다.
        계획은 아직 이행/검증되지 않았습니다.
      </p>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy}>
        <label>
          문서 처리 사유
          <textarea
            value={reason}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {(mayReview || mayRevise) && (
          <>
            <WorkPlanPicker
              path={`/sites/${site.id}/risk-authors`}
              label="보완/정정 초안의 현재 작성 가능 계정"
              disabled={busy}
              onSelect={setAuthorId}
            />
            <p>
              선택 작성 계정 {authorId}. 원 작성 계정 {row.author_id}은 제출본에
              그대로 남습니다. 소속이 해제된 계정은 새 초안 작성자로 지정할 수
              없습니다.
            </p>
          </>
        )}
        {!mayRevise && (
          <label>
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
            />
            문서 처리이며 안전·이행 완료·작업 재개 허가가 아님을 확인합니다.
          </label>
        )}
        {maySubmit && (
          <button
            disabled={!reason.trim() || !confirm}
            onClick={() => send("submit")}
          >
            현재 내용 고정·문서 검토 요청
          </button>
        )}
        {mayReview && (
          <>
            <button
              disabled={!reason.trim() || !confirm}
              onClick={() => send("accepted")}
            >
              문서 기록 수락
            </button>
            <button
              disabled={!reason.trim() || !confirm || !authorId}
              onClick={() => send("returned")}
            >
              보완 요청·새 작성 초안 생성
            </button>
          </>
        )}
        {mayRevise && (
          <button
            disabled={!reason.trim() || !authorId}
            onClick={() => send("revise")}
          >
            수락본 보존·미수락 정정 초안 생성
          </button>
        )}
      </fieldset>
    </section>
  );
}
