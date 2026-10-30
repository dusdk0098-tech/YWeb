import type { NarrativeQuestionKey } from "../server/risk-narrative-labels";
import { RiskNonNumericResidualValues,emptyResidualAnswers } from "./RiskNonNumericResidualValues";
import { RiskResidualValues, residualValueLabel } from "./RiskResidualValues";
import { useEffect, useRef, useState } from "react";
import { api, type Site } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import type { ResidualContext, ResidualRecord } from "../server/risk-residuals";
export const residualKind = {
  projected: "계획상 예상 재평가",
  after_confirmation: "조치 확인 후 입력한 재평가",
};
export function RiskResidualPanel({
  site,
  assessmentId,
  hazardId,
  onClose,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  assessmentId: string;
  hazardId: string;
  onClose: () => void;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [context, setContext] = useState<ResidualContext | null>(null),
    [page, setPage] = useState<{ items: ResidualRecord[]; hasMore: boolean }>({
      items: [],
      hasMore: false,
    }),
    [offset, setOffset] = useState(0),
    [kind, setKind] = useState<"projected" | "after_confirmation">("projected"),
    [likelihood, setLikelihood] = useState(""),
    [severity, setSeverity] = useState(""),
    [levelId, setLevelId] = useState(""),
    [basis, setBasis] = useState(""),
    [claimed, setClaimed] = useState(""),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [tick, setTick] = useState(0),
    [receipt, setReceipt] = useState<ResidualRecord | null>(null);
  const [outcome,setOutcome]=useState(""),[answers,setAnswers]=useState(emptyResidualAnswers),[decision,setDecision]=useState(""),[followupNotes,setFollowupNotes]=useState("");
  const priorFingerprint = useRef<string | null>(null);
  const base = `/sites/${site.id}/risk-assessments/${assessmentId}/hazards/${hazardId}/residuals`,
    dirty =
      !!outcome || Object.values(answers).some(Boolean) || !!decision || !!followupNotes ||
      !!levelId ||
      !!likelihood ||
      !!severity ||
      !!basis ||
      !!claimed ||
      !!reason ||
      confirmed,
    busy = loading || saving,
    guard = useDraftGuard(dirty, busy, onDirtyChange, onBusyChange);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setPage({ items: [], hasMore: false });
    Promise.all([
      api<ResidualContext>(base + "/context"),
      api<typeof page>(`${base}?offset=${offset}`),
    ])
      .then(([c, p]) => {
        if (active) {
          if (priorFingerprint.current !== c.fingerprint) {
            setConfirmed(false);
            priorFingerprint.current = c.fingerprint;
          }
          setContext(c);
          setPage(p);
        }
      })
      .catch((e) => {
        if (active) {
          setContext(null);
          setError(e.message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [base, offset, tick]);
  function clear() {
    setOutcome("");setAnswers(emptyResidualAnswers());setDecision("");setFollowupNotes("");
    setLevelId("");
    setLikelihood("");
    setSeverity("");
    setBasis("");
    setClaimed("");
    setReason("");
    setConfirmed(false);
  }
  async function save() {
    if (!context) return;
    const value = {
      kind,
      expectedVersion: context.versions[kind],
      contextFingerprint: context.fingerprint,
      ...(context.facts.criteria.body.method === "checklist"
        ? {method:"checklist",checklistItemId:"checklistItemId" in context.facts.hazard?context.facts.hazard.checklistItemId:null,outcome}
        : context.facts.criteria.body.method === "narrative"
        ? {method:"narrative",answers,additionalPlanDecision:decision,followupNotes}
        : context.facts.criteria.body.method === "three_level"
        ? { method: "three_level", levelId }
        : { likelihood: Number(likelihood), severity: Number(severity) }),
      basis,
      claimedLocalDate: claimed,
      reason,
      confirmManualEvaluation: confirmed,
    };
    setSaving(true);
    setError("");
    try {
      const result = await api<ResidualRecord>(
        base,
        "POST",
        value,
        guard.key(base, value),
      );
      setReceipt(result);
      clear();
      setTick((x) => x + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section>
      <button disabled={busy} onClick={() => guard.canLeave() && onClose()}>
        평가 문서로 돌아가기
      </button>
      <h2>위험행별 예상 / 조치 확인 후 입력한 재평가</h2>
      <p>
        두 종류는 별도 기록이며 예상값을 실행 후 값으로 자동 전환하지 않습니다.
        점수·선택 단계·사용자 기준 구간은 안전 판정/작업 허가가 아닙니다. 사람의 현장
        입력이며 소프트웨어 관측/독립기관 인증이 아닙니다.
      </p>
      {error && <p role="alert">{error}</p>}
      <button
        disabled={busy}
        onClick={() => {
          setLoading(true);
          setTick((x) => x + 1);
        }}
      >
        입력 보존·현재 참조 다시 조회
      </button>
      {loading && <p>원 평가/조치 참조 조회 중</p>}
      {context && (
        <>
          <h3>{context.facts.hazard.task}</h3>
          <p>
            원 제출 v{context.facts.submissionVersion} / 기준{" "}
            {context.facts.criteria.body.name} v{context.facts.criteria.version}
          </p>
          <p>{context.readinessNote}</p>
          <ul>
            {context.facts.actions.map((a) => (
              <li key={a.planIndex}>
                원 계획{a.planIndex + 1}: {a.action} /{" "}
                {a.actionId ?? "조치 미연결"} / v{a.version ?? "없음"} /{" "}
                {a.status ?? "미기록"}
              </li>
            ))}
          </ul>
          {site.role === "manager" && (
            <fieldset disabled={busy || !context.canRecord}>
              <label>
                기록 종류
                <select
                  value={kind}
                  onChange={(e) => {
                    if (guard.canLeave()) {
                      clear();
                      setKind(e.target.value as typeof kind);
                    }
                  }}
                >
                  {Object.entries(residualKind).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {kind === "after_confirmation" &&
                !context.afterConfirmationReady && (
                  <p role="alert">
                    이 경로의 소프트웨어 선행 조건이 미충족입니다. 법정
                    요건이거나 모든 위험 저감 보증이라는 뜻이 아닙니다.
                  </p>
                )}
              <RiskNonNumericResidualValues context={context} outcome={outcome} setOutcome={setOutcome} answers={answers} setAnswers={setAnswers} decision={decision} setDecision={setDecision} followupNotes={followupNotes} setFollowupNotes={setFollowupNotes}/>
              <RiskResidualValues
                criteria={context.facts.criteria.body}
                likelihood={likelihood} severity={severity} levelId={levelId}
                setLikelihood={setLikelihood} setSeverity={setSeverity} setLevelId={setLevelId}
              />
              <label>
                {context.facts.criteria.body.method === "narrative" ? `${context.facts.criteria.body.questions.additionalMeasures.prompt} — 여섯째 질문 답변/판단 근거 (${context.facts.criteria.body.questions.additionalMeasures.guidance})` : kind === "projected"
                  ? "예상 판단의 근거/전제"
                  : "사람이 입력한 재평가 근거"}
                <textarea
                  maxLength={5000}
                  value={basis}
                  onChange={(e) => setBasis(e.target.value)}
                />
              </label>
              <label>
                주장하는 현장 평가 날짜 (서버 UTC와 별도)
                <input
                  type="date"
                  value={claimed}
                  onChange={(e) => setClaimed(e.target.value)}
                />
              </label>
              <label>
                새 기록/정정 사유
                <textarea
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                선택한 종류의 재평가를 내 계정으로 입력하며, 점수·단계·비수치 답변도 실제
                안전/작업 허가를 자동 의미하지 않음을 확인합니다.
              </label>
              <button
                disabled={
                  (context.facts.criteria.body.method === "checklist" ? !outcome : context.facts.criteria.body.method === "narrative" ? (!decision || Object.values(answers).some(a=>!a.trim()) || (decision==="planned"&&!followupNotes.trim()) || (decision==="none_proposed"&&!!followupNotes.trim())) : context.facts.criteria.body.method === "three_level"
                    ? !levelId : (!likelihood || !severity)) ||
                  !basis.trim() ||
                  !claimed ||
                  !reason.trim() ||
                  !confirmed ||
                  (kind === "after_confirmation" &&
                    !context.afterConfirmationReady)
                }
                onClick={save}
              >
                {context.facts.criteria.body.method !== "product" ? "새 불변 사람 판단 기록 저장" : "새 불변 기록·서버 산술 저장"}
              </button>
            </fieldset>
          )}
        </>
      )}
      {receipt && (
        <p role="status">
          저장 응답: {residualKind[receipt.kind]} v{receipt.version} / {residualValueLabel(receipt.snapshot)}. 당시 성공 응답일 수 있으므로 아래
          현재 참조 변경 표시도 확인하세요.
        </p>
      )}
      <p>추가 실행계획의 담당/기한을 추적하려면 원 평가에서 명시 정정 또는 별도 새 평가를 작성하세요. 재평가 메모는 조치로 자동 전환되지 않습니다.</p>
      <button disabled={busy} onClick={()=>{if(guard.canLeave())onClose();}}>원 평가로 돌아가 정정/추가계획 경로 확인</button>
      <h3>불변 기록 이력 (종류별 버전)</h3>
      {page.items.map((r) => (
        <article key={r.id}>
          <h4>
            {residualKind[r.kind]} v{r.version}
          </h4>
          <p>
            {residualValueLabel(r.snapshot)} /{" "}
            {r.snapshot.result.criterionAcceptable === null ? "전체 허용/비허용 판정 없음 · 안전 허가 아님" : r.snapshot.result.criterionAcceptable
              ? "사용자 기준상 허용 분류 (안전 허가 아님)"
              : "사용자 기준상 비허용 분류 · 추가 검토 필요"}
          </p>
          <p>
            {r.stale
              ? "참조 변경됨: 원 평가/조치 버전이 당시와 다릅니다. 과거 기록을 최신 판단처럼 사용하지 마세요."
              : "현재 조회 참조와 같음 (실물 최신성/안전 보증 아님)"}
          </p>
          {r.snapshot.method === "three_level" && <p>당시 단계 판단 안내: {r.snapshot.result.description}</p>}
          {"judgmentUnresolved" in r.snapshot.result && r.snapshot.result.judgmentUnresolved && <p role="alert">부적합/추가 판단 필요가 남아 있습니다. 기록은 위험 해소가 아닙니다.</p>}
          {r.snapshot.method === "checklist" && <p>{r.snapshot.result.prompt} · {r.snapshot.result.guidance}</p>}
          {r.snapshot.method === "narrative" && <>{Object.entries(r.snapshot.answers).map(([key,value])=><p key={key}>{r.snapshot.context.criteria.body.method === "narrative" ? r.snapshot.context.criteria.body.questions[key as NarrativeQuestionKey].prompt : key}: {value}</p>)}<p>추가조치 제안 메모 (미배정/미실행): {r.snapshot.followupNotes||"기록 없음"}</p><p>여섯째 질문 답변/추가조치 판단 근거: {r.snapshot.context.criteria.body.method === "narrative" ? r.snapshot.context.criteria.body.questions.additionalMeasures.prompt : ""}</p></>}
          <p>{r.snapshot.basis}</p>
          <p>
            입력 현장일 {r.snapshot.claimedLocalDate} / 서버 UTC{" "}
            {r.snapshot.recordedAt} / 기록 계정 {r.snapshot.actor.name} / 사유{" "}
            {r.snapshot.reason}
          </p>
          <details>
            <summary>당시 기준·조치 ID/version/hash 참조</summary>
            <pre>{JSON.stringify(r.snapshot.context, null, 2)}</pre>
          </details>
        </article>
      ))}
      <button
        disabled={busy || !offset}
        onClick={() => {
          setLoading(true);
          setOffset((x) => x - 50);
        }}
      >
        이전50
      </button>
      <button
        disabled={busy || !page.hasMore}
        onClick={() => {
          setLoading(true);
          setOffset((x) => x + 50);
        }}
      >
        다음50
      </button>
    </section>
  );
}
