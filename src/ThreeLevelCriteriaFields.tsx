import type { ThreeLevelCriteria } from "../server/risk-three-level-model";
export function ThreeLevelCriteriaFields({
  body,
  onChange,
}: {
  body: ThreeLevelCriteria;
  onChange: (v: ThreeLevelCriteria) => void;
}) {
  return (
    <>
      <p>
        세 단계는 사람이 정의하고 선택합니다. 숫자/순위 점수로 변환하지 않으며
        법정 기본 기준은 없습니다.
      </p>
      {body.levels.map((l, i) => (
        <fieldset key={l.id}>
          <legend>단계 정의 {i + 1} (표시 순서일 뿐 점수 아님)</legend>
          <label>
            서로 다른 단계 이름
            <input
              maxLength={200}
              value={l.label}
              onChange={(e) =>
                onChange({
                  ...body,
                  levels: body.levels.map((v, n) =>
                    n === i ? { ...v, label: e.target.value } : v,
                  ),
                })
              }
            />
          </label>
          <label>
            이 단계를 선택할 판단 기준
            <textarea
              maxLength={2000}
              value={l.description}
              onChange={(e) =>
                onChange({
                  ...body,
                  levels: body.levels.map((v, n) =>
                    n === i ? { ...v, description: e.target.value } : v,
                  ),
                })
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={l.criterionAcceptable}
              onChange={(e) =>
                onChange({
                  ...body,
                  levels: body.levels.map((v, n) =>
                    n === i
                      ? { ...v, criterionAcceptable: e.target.checked }
                      : v,
                  ),
                })
              }
            />
            사용자가 정의한 허용 분류 (실제 안전 판정/작업 허가 아님)
          </label>
        </fieldset>
      ))}
    </>
  );
}
