import {
  narrativeQuestionLabels,
  type NarrativeQuestionKey,
} from "../server/risk-narrative-labels";
import type { NarrativeCriteria } from "../server/risk-narrative-model";
export function NarrativeCriteriaFields({ body, onChange }: {
  body: NarrativeCriteria;
  onChange: (v: NarrativeCriteria) => void;
}) {
  return <>
    <p>여섯 핵심 내용의 질문·작성 안내를 직접 정합니다. 법정 표준 양식이나 안전 판정 규칙이 아닙니다.</p>
    {(Object.entries(narrativeQuestionLabels) as [NarrativeQuestionKey, string][]).map(([key, label]) =>
      <fieldset key={key}>
        <legend>{label}</legend>
        <label>자체 질문
          <textarea maxLength={1000} value={body.questions[key].prompt}
            onChange={(e) => onChange({ ...body, questions: { ...body.questions,
              [key]: { ...body.questions[key], prompt: e.target.value } } })} />
        </label>
        <label>작성 안내
          <textarea maxLength={2000} value={body.questions[key].guidance}
            onChange={(e) => onChange({ ...body, questions: { ...body.questions,
              [key]: { ...body.questions[key], guidance: e.target.value } } })} />
        </label>
      </fieldset>) }
  </>;
}
