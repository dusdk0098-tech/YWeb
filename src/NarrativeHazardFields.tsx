import {
  narrativeQuestionLabels,
  narrativeDecisionLabels,
  type NarrativeQuestionKey,
} from "../server/risk-narrative-labels";
import type { NarrativeCriteria, NarrativeHazard } from "../server/risk-narrative-model";
export function NarrativeHazardFields({ h, criteria, change }: {
  h: NarrativeHazard;
  criteria: NarrativeCriteria | null;
  change: (id: string, patch: Partial<NarrativeHazard>) => void;
}) {
  return <>
    <p>고정 질문에 대한 사람의 서술입니다. 점수·전체 위험 허용 분류를 만들지 않습니다. 피해 대상은 집단 수준으로 쓰고 민감 개인정보를 입력하지 마세요.</p>
    {(Object.entries(narrativeQuestionLabels) as [NarrativeQuestionKey, string][]).map(([key, label]) => {
      const field = key === "additionalMeasures" ? "judgmentReason" : key;
      return <div key={key}>
        <label>{label}: {criteria?.questions[key].prompt || "확인 기준 미선택"}
          <textarea maxLength={key === "exposedGroup" ? 300 : 2000} value={h[field]}
            onChange={(e) => change(h.id, { [field]: e.target.value })} />
        </label>
        <p>{criteria?.questions[key].guidance}</p>
      </div>;
    })}
    <label>추가조치에 대한 사람의 명시 판단
      <select value={h.additionalPlanDecision ?? ""}
        onChange={(e) => change(h.id, { additionalPlanDecision: (e.target.value || null) as NarrativeHazard["additionalPlanDecision"] })}>
        <option value="">미선택 (판단 기록 전)</option>
        {Object.entries(narrativeDecisionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    {h.additionalPlanDecision === "further_review" && <p role="status">판단 미확정 상태를 문서에 남깁니다. 문서가 수락되어도 이 판단을 안전 승인이나 해결 완료로 바꾸지 않습니다.</p>}
    {h.additionalPlanDecision === "planned" && <p>아래 계획에 내용·담당 메모·예정일·통제유형을 입력하세요. 실제 이행이나 계정 배정 완료는 아닙니다.</p>}
    {h.additionalPlanDecision === "none_proposed" && <p>추가조치를 제안하지 않았다는 기록입니다. 근거를 남기며 실제 안전·법적 적합성을 뜻하지 않습니다.</p>}
  </>;
}
