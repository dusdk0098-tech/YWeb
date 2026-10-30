import { useState } from "react";
import { api, type Site } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import type { RiskAssessmentRecord } from "../server/risk-core";
import type { RiskOpinion } from "../server/risk-opinions";
export function RiskOpinionCreate({
  site,
  initial,
  onClose,
  onSaved,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  initial: RiskAssessmentRecord;
  onClose: () => void;
  onSaved: (r: RiskOpinion) => void;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [source, setSource] = useState(initial),
    [text, setText] = useState(""),
    [hazardId, setHazardId] = useState(""),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const guard = useDraftGuard(
    !!text || !!hazardId || confirm,
    busy,
    onDirtyChange,
    onBusyChange,
  );
  async function reload() {
    setBusy(true);
    setError("");
    try {
      setSource(
        await api<RiskAssessmentRecord>(
          `/sites/${site.id}/risk-assessments/${source.id}`,
        ),
      );
      setConfirm(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    const path = `/sites/${site.id}/risk-assessments/${source.id}/opinions`,
      value = {
        submissionHash: source.submission_hash,
        hazardId: hazardId || null,
        text,
        confirmAccountOpinion: confirm,
      };
    setBusy(true);
    setError("");
    try {
      onSaved(
        await api<RiskOpinion>(path, "POST", value, guard.key(path, value)),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <button disabled={busy} onClick={() => guard.canLeave() && onClose()}>
        의견 목록
      </button>
      <h2>내 계정의 문서 의견</h2>
      <p>
        근로자 본인 참여·대리 확인·서명·출역/교육 이수 증거가 아닙니다. 의견
        원문은 작성 계정과 현재 현장 관리자에게만 보입니다. 실제 근로자/협력
        참여를 대신 증명하지 않습니다.
      </p>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy} onClick={reload}>
        입력 보존·원문 현재 상태 조회
      </button>
      <p>
        {source.body.title} / 제출 v{source.submission?.version} /{" "}
        {source.submission_hash}
      </p>
      {source.successor_id && (
        <p role="alert">
          후속 문서가 있습니다. 새 의견은 후속 제출/수락 문서에서 작성하세요.
        </p>
      )}
      <fieldset
        disabled={
          busy ||
          !!source.successor_id ||
          !["submitted", "accepted"].includes(source.status)
        }
      >
        <label>
          대상 위험행
          <select
            value={hazardId}
            onChange={(e) => setHazardId(e.target.value)}
          >
            <option value="">문서 전체</option>
            {source.submission?.body.hazards.map((h) => (
              <option key={h.id} value={h.id}>
                {h.task} / {h.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          현재 계정의 의견/추가 위험 제안 (민감 개인정보 제외)
          <textarea
            value={text}
            maxLength={5000}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={confirm}
            onChange={(e) => setConfirm(e.target.checked)}
          />
          내 계정 의견이며 다른 사람의 참여/동의/서명을 대신 기록하지 않습니다.
        </label>
        <button disabled={!text.trim() || !confirm} onClick={save}>
          고정 문서에 내 의견 기록
        </button>
      </fieldset>
    </section>
  );
}
