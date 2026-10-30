import type { ChecklistCriteria } from "../server/risk-checklist-model";
export function ChecklistCriteriaFields({
  body,
  onChange,
}: {
  body: ChecklistCriteria;
  onChange: (v: ChecklistCriteria) => void;
}) {
  return (
    <>
      <p>
        자체 작성한1–50개 항목입니다. 적합 응답은 해당 질문에 대한 사람 판단이며
        전체 안전/준법 인증이 아닙니다.
      </p>
      {body.items.map((item, i) => (
        <fieldset key={item.id}>
          <legend>
            체크항목 {i + 1} / {item.id}
          </legend>
          <label>
            질문
            <input
              maxLength={1000}
              value={item.prompt}
              onChange={(e) =>
                onChange({
                  ...body,
                  items: body.items.map((v, n) =>
                    n === i ? { ...v, prompt: e.target.value } : v,
                  ),
                })
              }
            />
          </label>
          <label>
            적합/부적합/해당없음 판단 안내
            <textarea
              maxLength={2000}
              value={item.guidance}
              onChange={(e) =>
                onChange({
                  ...body,
                  items: body.items.map((v, n) =>
                    n === i ? { ...v, guidance: e.target.value } : v,
                  ),
                })
              }
            />
          </label>
          <button
            type="button"
            onClick={() =>
              ((!item.prompt && !item.guidance) ||
                window.confirm(
                  "이 초안의 질문/판단 안내를 제거할까요? 이전 저장본은 이력에 남습니다.",
                )) &&
              onChange({
                ...body,
                items: body.items.filter((v) => v.id !== item.id),
              })
            }
          >
            초안 항목 제거
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={body.items.length >= 50}
        onClick={() =>
          onChange({
            ...body,
            items: [
              ...body.items,
              { id: crypto.randomUUID(), prompt: "", guidance: "" },
            ],
          })
        }
      >
        빈 체크항목 추가 (최대50)
      </button>
    </>
  );
}
