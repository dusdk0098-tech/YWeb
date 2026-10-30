import { useState } from "react";
import { api, type Site } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import { WorkPlanPicker } from "./WorkPlanPicker";
import type { RiskAssessmentRecord } from "../server/risk-core";
import type { RiskAction } from "../server/risk-actions";
export function RiskActionCreate({
  site,
  onClose,
  onSaved,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  onClose: () => void;
  onSaved: (v: RiskAction) => void;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [source, setSource] = useState<RiskAssessmentRecord | null>(null),
    [selected, setSelected] = useState(""),
    [assigneeId, setAssigneeId] = useState(""),
    [due, setDue] = useState(""),
    [reason, setReason] = useState(""),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const guard = useDraftGuard(
    !!source || !!selected || !!assigneeId || !!due || !!reason || confirm,
    busy,
    onDirtyChange,
    onBusyChange,
  );
  async function choose(id: string) {
    if (
      source &&
      !window.confirm(
        "원 문서를 바꾸면 선택 계획/예정일을 비웁니다. 담당/사유 메모는 유지합니다.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const row = await api<RiskAssessmentRecord>(
        `/sites/${site.id}/risk-assessments/${id}`,
      );
      setSource(row);
      setSelected("");
      setDue("");
      setConfirm(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const plans =
    source?.submission?.body.hazards
      .flatMap((h) =>
        h.plans.map((p, i) => ({
          key: `${h.id}:${i}`,
          hazard: h,
          plan: p,
          index: i,
        })),
      )
      .filter((x) => x.plan.action.trim()) ?? [];
  const choice = plans.find((x) => x.key === selected);
  async function create() {
    if (!source || !choice) return;
    const path = `/sites/${site.id}/risk-assessments/${source.id}/actions`,
      value = {
        version: source.version,
        hazardId: choice.hazard.id,
        planIndex: choice.index,
        assigneeId,
        due,
        reason,
        confirmManualTracking: confirm,
      };
    setBusy(true);
    setError("");
    try {
      const row = await api<RiskAction>(
        path,
        "POST",
        value,
        guard.key(path, value),
      );
      onSaved(row);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <button disabled={busy} onClick={() => guard.canLeave() && onClose()}>
        조치 목록
      </button>
      <h2>원 계획의 수기 조치 기록 시작</h2>
      <p>
        원 문서 수락이 실제 위험 허용이나 조치 완료를 뜻하지 않습니다. 선택 계획
        한 개의 이행보고와 사람 확인을 별도 기록합니다. 다른 계획/위험 전체가
        자동 완료되지 않습니다.
      </p>
      {error && <p role="alert">{error}</p>}
      <WorkPlanPicker
        path={`/sites/${site.id}/risk-assessments?status=accepted`}
        label="문서 기록 수락본 선택"
        disabled={busy}
        onSelect={choose}
      />
      {source && (
        <>
          <p>
            {source.body.title} / {source.id} / v{source.version}
          </p>
          {source.successor_id && (
            <p role="alert">
              후속 문서가 있어 이 원본의 새 조치 시작은 중단됩니다. 기존 조치는
              보존됩니다. 후속 수락 문서를 선택하세요.
            </p>
          )}
          <fieldset disabled={busy}>
            <label>
              고정 원 계획
              <select
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setDue(
                    plans.find((x) => x.key === e.target.value)?.plan.due ?? "",
                  );
                  setConfirm(false);
                }}
              >
                <option value="">선택</option>
                {plans.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.hazard.task} / 계획{x.index + 1}:{" "}
                    {x.plan.action.slice(0, 120)}
                  </option>
                ))}
              </select>
            </label>
            {choice && (
              <p>
                원 담당 메모: {choice.plan.ownerNote || "미기록"} / 원 예정일:{" "}
                {choice.plan.due || "미기록"} (현재 계정 배정과 별도)
              </p>
            )}
            <WorkPlanPicker
              path={`/sites/${site.id}/risk-authors`}
              label="현재 조치 담당 계정"
              disabled={busy}
              onSelect={setAssigneeId}
            />
            <p>선택 계정 {assigneeId || "없음"}</p>
            <label>
              관리자가 기록할 예정일
              <input
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
            <label>
              시작/배정 사유
              <textarea
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={confirm}
                onChange={(e) => setConfirm(e.target.checked)}
              />
              실제 작업 명령·자동 안전 판정 없이 이 원 계획의 수기 추적 기록을
              시작합니다.
            </label>
            <button
              disabled={
                !choice ||
                !assigneeId ||
                !due ||
                !reason.trim() ||
                !confirm ||
                !!source.successor_id
              }
              onClick={create}
            >
              고정 출처와 담당으로 시작
            </button>
          </fieldset>
        </>
      )}
    </section>
  );
}
