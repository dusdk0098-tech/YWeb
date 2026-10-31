import { useState } from "react";
import { Notice } from "./ui";
import { api, type Site, type User } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import { WorkPlanPicker } from "./WorkPlanPicker";
import { CompanyPpeHistory } from "./CompanyPpeHistory";
import type { RiskAction } from "../server/risk-actions";
export const riskActionStatus = {
  assigned: "배정·보고 대기",
  reported: "담당자 이행보고 기록",
  verified: "다른 관리자의 확인 기록 (자동 관측 아님)",
};
export function RiskActionEditor({
  site,
  user,
  initial,
  onClose,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  user: User;
  initial: RiskAction;
  onClose: () => void;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [row, setRow] = useState(initial),
    [mode, setMode] = useState<"report" | "assign" | "verify" | "reopen" | "">(
      "",
    ),
    [reason, setReason] = useState(""),
    [text, setText] = useState(""),
    [claimed, setClaimed] = useState(""),
    [due, setDue] = useState(initial.due),
    [assigneeId, setAssigneeId] = useState(initial.assignee_id),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const dirty =
      !!reason ||
      !!text ||
      !!claimed ||
      confirm ||
      due !== row.due ||
      assigneeId !== row.assignee_id,
    guard = useDraftGuard(dirty, busy, onDirtyChange, onBusyChange),
    base = `/sites/${site.id}/risk-actions/${row.id}`,
    manager = site.role === "manager",
    assigned = row.assignee_id === user.id;
  function adopt(next: RiskAction) {
    setRow(next);
    setReason("");
    setText("");
    setClaimed("");
    setDue(next.due);
    setAssigneeId(next.assignee_id);
    setConfirm(false);
    setMode("");
  }
  function select(next: typeof mode) {
    if (guard.canLeave()) {
      setMode(next);
      setReason("");
      setText("");
      setClaimed("");
      setDue(row.due);
      setAssigneeId(row.assignee_id);
      setConfirm(false);
    }
  }
  async function reload() {
    if (!guard.canLeave()) return;
    setBusy(true);
    setError("");
    try {
      adopt(await api<RiskAction>(base));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send(decision: "confirm" | "reject" = "confirm") {
    const path = base + "/" + mode,
      value =
        mode === "assign"
          ? { version: row.version, assigneeId, due, reason }
          : mode === "report"
            ? {
                version: row.version,
                text,
                claimedLocalDate: claimed,
                reason,
                confirmHumanReport: confirm,
              }
            : mode === "verify"
              ? {
                  version: row.version,
                  decision,
                  note: text,
                  claimedLocalDate: claimed,
                  reason,
                  confirmHumanVerification: confirm,
                }
              : { version: row.version, reason };
    setBusy(true);
    setError("");
    try {
      adopt(await api<RiskAction>(path, "POST", value, guard.key(path, value)));
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
      <button disabled={busy} onClick={reload}>
        현재 상태 다시 조회
      </button>
      <h2>{riskActionStatus[row.status]}</h2>
      <Notice summary="사람이 보고·확인한 기록입니다. 작업 재개 허가가 아닙니다.">
        사람이 보고/확인했다고 기록한 내용이며 소프트웨어가 실물 완료를 관측한
        것이 아닙니다. 위험행별 별도 재평가는 평가 문서에서 조회합니다. 이 조치
        기록은 전체 위험 해소나 작업 재개 허가를 뜻하지 않습니다.
      </Notice>
      {error && <p role="alert">{error}</p>}
      <p>
        담당: {row.assignee.name} / {row.assignee_id} · 예정일 {row.due} ·
        version {row.version}
      </p>
      <h3>고정 원 계획</h3>
      <p>
        {row.source.assessmentTitle} / 원 제출 v{row.source.submissionVersion} /{" "}
        {row.source.assessmentId}
      </p>
      <p>
        {row.source.hazard.task} /{" "}
        {row.source.hazard.plans[row.source.planIndex].action}
      </p>
      <p>
        원 예정일{" "}
        {row.source.hazard.plans[row.source.planIndex].due ?? "미기록"} / 현재
        배정 예정일 {row.due}
      </p>
      {row.sourceDocument.successorId && (
        <p role="alert">
          원 문서에 후속 문서 {row.sourceDocument.successorId} (
          {row.sourceDocument.successorStatus})가 있습니다. 이 조치는 이전 원문
          출처를 유지하며 자동 이동/완료되지 않습니다. 현재 표시된 연결 상태는
          마지막 조회 시점입니다.
        </p>
      )}
      <details>
        <summary>출처 전체 보관본</summary>
        <pre>{JSON.stringify(row.source, null, 2)}</pre>
      </details>
      {row.report && (
        <>
          <h3>담당자가 기록한 이행보고</h3>
          <p>{row.report.text}</p>
          <p>
            주장한 현장 이행일 {row.report.claimedLocalDate} / 서버 기록 UTC{" "}
            {row.report.recordedAt} / {row.report.actor.name}
          </p>
        </>
      )}
      {row.verification && (
        <>
          <h3>다른 관리자가 기록한 확인</h3>
          <p>{row.verification.note}</p>
          <p>
            주장한 현장 확인일 {row.verification.claimedLocalDate} / 서버 기록
            UTC {row.verification.recordedAt} / {row.verification.actor.name}
          </p>
        </>
      )}
      <div>
        {assigned && site.role !== "viewer" && row.status !== "verified" && (
          <button disabled={busy} onClick={() => select("report")}>
            {row.status === "reported" ? "보고 사유 정정" : "이행보고 기록"}
          </button>
        )}
        {manager && row.status !== "verified" && (
          <button disabled={busy} onClick={() => select("assign")}>
            사유로 재배정/예정일 변경
          </button>
        )}
        {manager &&
          !assigned &&
          row.report?.actor.id !== user.id &&
          row.status === "reported" && (
            <button disabled={busy} onClick={() => select("verify")}>
              다른 관리자 확인/반려
            </button>
          )}
        {manager && row.status === "verified" && (
          <button disabled={busy} onClick={() => select("reopen")}>
            확인 기록 사유 재개방
          </button>
        )}
      </div>
      {row.status === "reported" && manager && assigned && (
        <p>
          본인 배정/보고는 다른 현장 관리자가 확인해야 합니다. 관리자 부족 시
          자기 확인으로 우회하지 않습니다.
        </p>
      )}
      {mode && (
        <fieldset disabled={busy}>
          <legend>{mode} · 이전 사건은 보존</legend>
          {mode === "assign" && (
            <>
              <WorkPlanPicker
                path={`/sites/${site.id}/risk-authors`}
                label="새 현재 담당 계정"
                disabled={busy}
                onSelect={setAssigneeId}
              />
              <p>{assigneeId}</p>
              <label>
                예정일
                <input
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              </label>
              <p>
                재배정/예정일 변경은 현재 보고/확인을 비우고 다시 보고하도록
                합니다. 이전 내용은 이력에 남습니다.
              </p>
            </>
          )}
          {(mode === "report" || mode === "verify") && (
            <>
              <label>
                {mode === "report"
                  ? "실제 이행에 대한 담당자 보고"
                  : "사람이 확인/반려한 의견"}
                <textarea
                  maxLength={5000}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </label>
              <label>
                주장하는 현장 {mode === "report" ? "이행" : "확인"} 날짜
                <input
                  type="date"
                  value={claimed}
                  onChange={(e) => setClaimed(e.target.value)}
                />
              </label>
              <p>
                현장 입력 날짜는 서버 UTC 사건시각과 별도입니다. 확인일은 보고된
                이행일보다 빠를 수 없습니다.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={confirm}
                  onChange={(e) => setConfirm(e.target.checked)}
                />
                내 계정으로 사람의 보고/검토 사실을 기록합니다. 자동 완료
                관측이나 안전 허가가 아닙니다.
              </label>
            </>
          )}
          <label>
            사유
            <textarea
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {mode === "reopen" && (
            <p>
              현재 보고/확인을 비우고 보고 대기로 되돌립니다. 과거 확인을
              삭제하거나 실제 작업을 재개하는 명령이 아닙니다.
            </p>
          )}
          <button
            disabled={
              !reason.trim() ||
              ((mode === "report" || mode === "verify") &&
                (!text.trim() || !claimed || !confirm)) ||
              (mode === "assign" && (!due || !assigneeId))
            }
            onClick={() => send()}
          >
            {mode === "verify"
              ? "사람 확인 기록"
              : mode === "reopen"
                ? "기록 재개방"
                : "기록 저장"}
          </button>
          {mode === "verify" && (
            <button
              disabled={!reason.trim() || !text.trim() || !claimed || !confirm}
              onClick={() => send("reject")}
            >
              보고 반려·다시 보고 대기
            </button>
          )}
          <button onClick={() => select("")}>입력 닫기</button>
        </fieldset>
      )}
      <p>
        재시도 응답은 당시 성공 기록일 수 있으니 현재 상태 다시 조회로
        확인하세요.
      </p>
      <CompanyPpeHistory path={base + "/events"} version={row.version} />
    </section>
  );
}
