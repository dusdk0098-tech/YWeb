import { useState } from "react";
import { api, type Site, type User } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import { CompanyPpeHistory } from "./CompanyPpeHistory";
import type { RiskOpinion } from "../server/risk-opinions";
export const opinionOutcome = {
  planned: "반영 계획 (문서 변경 완료 아님)",
  not_applied: "미반영 사유 기록",
  needs_information: "추가 확인 요청",
};
export function RiskOpinionEditor({
  site,
  user,
  initial,
  onClose,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  user: User;
  initial: RiskOpinion;
  onClose: () => void;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [row, setRow] = useState(initial),
    [mode, setMode] = useState<"amend" | "respond" | "">(""),
    [text, setText] = useState(""),
    [reason, setReason] = useState(""),
    [outcome, setOutcome] =
      useState<keyof typeof opinionOutcome>("needs_information"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const guard = useDraftGuard(
      !!text || !!reason || outcome !== "needs_information",
      busy,
      onDirtyChange,
      onBusyChange,
    ),
    base = `/sites/${site.id}/risk-opinions/${row.id}`;
  function choose(value: typeof mode) {
    if (guard.canLeave()) {
      setMode(value);
      setText("");
      setReason("");
      setOutcome("needs_information");
    }
  }
  function adopt(r: RiskOpinion) {
    setRow(r);
    setMode("");
    setText("");
    setReason("");
    setOutcome("needs_information");
  }
  async function reload() {
    if (!guard.canLeave()) return;
    setBusy(true);
    setError("");
    try {
      adopt(await api<RiskOpinion>(base));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    const path = base + "/" + mode,
      value =
        mode === "amend"
          ? { version: row.version, text, reason }
          : { version: row.version, outcome, note: text, reason };
    setBusy(true);
    setError("");
    try {
      adopt(
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
      <button disabled={busy} onClick={reload}>
        현재 상태 다시 조회
      </button>
      <h2>
        계정 의견 ·{" "}
        {row.status === "open" ? "현재 관리자 응답 대기" : "관리자 응답 기록"}
      </h2>
      <p>
        현재 작성 계정/관리자에게만 공개. 근로자 참여 증명·독립 심사·서명·실제
        위험 해소가 아닙니다. 관리자 자신의 의견에 답한 경우도 독립 확인으로
        표현하지 않습니다.
      </p>
      {error && <p role="alert">{error}</p>}
      <p>
        원 문서 {row.source.title} / {row.source.assessmentId} / 제출v
        {row.source.submissionVersion} / {row.source.task ?? "문서 전체"}
      </p>
      {row.sourceDocument.successorId && (
        <p role="alert">
          원문에 후속 문서 {row.sourceDocument.successorId}가 있습니다. 의견은
          원 출처를 유지하며 자동 이동/반영하지 않습니다.
        </p>
      )}
      <h3>불변 최초 의견</h3>
      <p>{row.original.text}</p>
      <p>
        {row.original.author.name} ({row.original.author.id}) / 서버 UTC{" "}
        {row.original.recordedAt}
      </p>
      <h3>현재 보충/정정된 의견</h3>
      <p>{row.current_text}</p>
      {row.response ? (
        <>
          <h3>{opinionOutcome[row.response.outcome]}</h3>
          <p>{row.response.note}</p>
          <p>
            응답 대상 당시 의견 version{row.response.opinionVersion} /{" "}
            {row.response.actor.name} ({row.response.actor.id}) /{" "}
            {row.response.recordedAt}
          </p>
        </>
      ) : (
        <p>현재 응답 미기록/초기화됨. 이전 응답은 사건 이력에서 확인하세요.</p>
      )}
      <p>
        반영 계획/응답을 저장해도 평가 본문이나 조치/재평가 상태가 자동 바뀌지
        않습니다.
      </p>
      {site.role !== "viewer" && row.author_id === user.id && (
        <button disabled={busy} onClick={() => choose("amend")}>
          내 의견 사유 보충/정정
        </button>
      )}
      {site.role === "manager" && (
        <button disabled={busy} onClick={() => choose("respond")}>
          관리자 응답/사유 정정
        </button>
      )}
      {mode && (
        <fieldset disabled={busy}>
          <legend>
            {mode === "amend" ? "의견 보충/정정" : "관리자 응답"} · 과거 기록
            보존
          </legend>
          {mode === "respond" && (
            <label>
              응답 종류
              <select
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as typeof outcome)}
              >
                {Object.entries(opinionOutcome).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            {mode === "amend" ? "보충/정정한 전체 의견" : "응답/판단 근거"}
            <textarea
              maxLength={5000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <label>
            변경/응답 사유
            <textarea
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {mode === "amend" && (
            <p>
              현재 응답은 비우고 다시 검토할 수 있도록 합니다. 최초 의견/이전
              응답은 삭제하지 않습니다.
            </p>
          )}
          <button disabled={!text.trim() || !reason.trim()} onClick={save}>
            사유와 새 사건 저장
          </button>
          <button onClick={() => choose("")}>입력 닫기</button>
        </fieldset>
      )}
      <p>
        같은 요청의 재시도는 당시 성공 응답일 수 있으므로 현재 상태 다시 조회를
        사용하세요.
      </p>
      <CompanyPpeHistory path={base + "/events"} version={row.version} />
    </section>
  );
}
