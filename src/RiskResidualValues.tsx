import type { ResidualContext, ResidualSnapshot } from "../server/risk-residuals";
export function residualValueLabel(snapshot: ResidualSnapshot) {
  if(snapshot.method === "checklist" || snapshot.method === "narrative")return `사람 판단 ${snapshot.result.bandLabel} (점수/전체 허용 판정 없음)`;
  return snapshot.method === "three_level"
    ? `사람 선택 ${snapshot.result.bandLabel} (숫자 점수 없음)`
    : `점수 ${snapshot.result.score} / 사용자 설정 구간 ${snapshot.result.bandLabel}`;
}
export function RiskResidualValues({ criteria, likelihood, severity, levelId, setLikelihood, setSeverity, setLevelId }: {
  criteria: ResidualContext["facts"]["criteria"]["body"];
  likelihood: string;
  severity: string;
  levelId: string;
  setLikelihood: (v: string) => void;
  setSeverity: (v: string) => void;
  setLevelId: (v: string) => void;
}) {
  if (criteria.method === "three_level") return <>
    <p>원 문서에 고정된 세 단계 중 사람이 선택합니다. 표시 순서는 점수가 아니며 수치 산술로 변환하지 않습니다.</p>
    <label>사람이 선택한 재평가 단계
      <select value={levelId} onChange={(e) => setLevelId(e.target.value)}>
        <option value="">미선택 (0점/허용 아님)</option>
        {criteria.levels.map((level) => <option key={level.id} value={level.id}>{level.label}: {level.description}</option>)}
      </select>
    </label>
    {levelId && <p>{criteria.levels.find((level) => level.id === levelId)?.description}</p>}
  </>;
  if(criteria.method !== "product")return null;
  return <>
    <label>가능성<select value={likelihood} onChange={(e) => setLikelihood(e.target.value)}>
      <option value="">선택</option>
      {criteria.likelihood.map((x, i) => <option key={i} value={i + 1}>{i + 1}: {x}</option>)}
    </select></label>
    <label>중대성<select value={severity} onChange={(e) => setSeverity(e.target.value)}>
      <option value="">선택</option>
      {criteria.severity.map((x, i) => <option key={i} value={i + 1}>{i + 1}: {x}</option>)}
    </select></label>
  </>;
}
