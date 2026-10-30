import { NarrativeHazardFields } from "./NarrativeHazardFields";
import type { MethodAssessment, MethodCriteria } from "../server/risk-methods";
type Hazard = MethodAssessment["hazards"][number];
export function RiskHazardFields({
  h,
  i,
  disabled,
  criteria,
  change,
  onRemove,
}: {
  h: Hazard;
  i: number;
  disabled: boolean;
  criteria: MethodCriteria | null;
  change: (id: string, patch: Partial<Hazard>) => void;
  onRemove: () => void;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend>위험행 {i + 1}</legend>
      {(
        [
          ["task", "세부 작업"],
          ["location", "위치"],
          ["category", "위험 분류"],
          ["accidentType", "사고 형태"],
          ["scenario", "발생 상황"],
          ["harm", "예상 피해"],
          ["exposedGroup", "노출 대상 집단 (민감 개인정보 제외)"],
          ["reference", "관련 근거/기준"],
          ["currentControls", "현재 조치"],
          ["judgmentReason", "판단 근거 (사람 입력)"],
        ] as const
      ).filter(([k]) => !("exposurePath" in h) || !["scenario", "harm", "exposedGroup", "currentControls", "judgmentReason"].includes(k)).map(([k, label]) => (
        <label key={k}>
          {label}
          <textarea
            maxLength={
              ["location", "exposedGroup"].includes(k)
                ? 300
                : ["category", "accidentType"].includes(k)
                  ? 200
                  : 2000
            }
            value={h[k]}
            onChange={(e) => change(h.id, { [k]: e.target.value })}
          />
        </label>
      ))}
      {"exposurePath" in h && <NarrativeHazardFields h={h} criteria={criteria?.method === "narrative" ? criteria : null} change={change} />}
      {"checklistItemId" in h && (
        <>
          <label>
            고정 기준의 체크항목
            <select
              disabled={!criteria || criteria.method !== "checklist"}
              value={h.checklistItemId ?? ""}
              onChange={(e) => {
                if (
                  (h.outcome || h.judgmentReason) &&
                  !window.confirm(
                    "체크항목을 바꾸면 현재 응답과 판단 근거를 비웁니다. 계속할까요?",
                  )
                )
                  return;
                change(h.id, {
                  checklistItemId: e.target.value || null,
                  outcome: null,
                  judgmentReason: "",
                });
              }}
            >
              <option value="">미연결</option>
              {criteria?.method === "checklist" &&
                criteria.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.prompt}
                  </option>
                ))}
            </select>
          </label>
          <p>
            {criteria?.method === "checklist"
              ? criteria.items.find((item) => item.id === h.checklistItemId)
                  ?.guidance
              : ""}
          </p>
          <label>
            사람의 항목별 응답
            <select
              disabled={!h.checklistItemId}
              value={h.outcome ?? ""}
              onChange={(e) =>
                change(h.id, {
                  outcome: (e.target.value || null) as typeof h.outcome,
                })
              }
            >
              <option value="">응답 대기 (적합 아님)</option>
              <option value="compliant">적합</option>
              <option value="noncompliant">부적합</option>
              <option value="not_applicable">해당없음 (사유 필요)</option>
            </select>
          </label>
          <p>
            항목 연결 변경 시 응답/판단 근거가 비워집니다. 해당없음 포함 모든
            응답에 판단 근거를 작성하세요. 전체 안전 판정이 아닙니다.
          </p>
        </>
      )}
      {"levelId" in h && (
        <label>
          사람이 선택한 단계 (산술 점수 아님)
          <select
            disabled={!criteria || criteria.method !== "three_level"}
            value={h.levelId ?? ""}
            onChange={(e) => change(h.id, { levelId: e.target.value || null })}
          >
            <option value="">미평가</option>
            {criteria?.method === "three_level" &&
              criteria.levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}: {l.description}
                </option>
              ))}
          </select>
        </label>
      )}
      {"likelihood" in h &&
        (["likelihood", "severity"] as const).map((k) => (
          <label key={k}>
            {k === "likelihood" ? "가능성" : "중대성"}
            <select
              disabled={!criteria}
              value={h[k] ?? ""}
              onChange={(e) =>
                change(h.id, {
                  [k]: e.target.value ? Number(e.target.value) : null,
                })
              }
            >
              <option value="">미평가</option>
              {(criteria?.method === "product" ? criteria[k] : []).map(
                (label, n) => (
                  <option key={n} value={n + 1}>
                    {n + 1}: {label}
                  </option>
                ),
              )}
            </select>
          </label>
        ))}
      {h.plans.map((p, n) => (
        <div key={n}>
          <h4>저감 계획 {n + 1} (미이행/미검증)</h4>
          {(
            ["action", "ownerNote", "priorityNote", "preconditions"] as const
          ).map((k) => (
            <label key={k}>
              {
                {
                  action: "조치 내용",
                  ownerNote: "담당/소속 수기 메모 (배정 확인 아님)",
                  priorityNote: "우선순위 메모",
                  preconditions: "실행 전 조건",
                }[k]
              }
              <textarea
                value={p[k]}
                maxLength={
                  k === "ownerNote" || k === "priorityNote" ? 200 : 2000
                }
                onChange={(e) =>
                  change(h.id, {
                    plans: h.plans.map((x, j) =>
                      j === n ? { ...x, [k]: e.target.value } : x,
                    ),
                  })
                }
              />
            </label>
          ))}
          <label>
            통제 유형
            <select
              value={p.controlType}
              onChange={(e) =>
                change(h.id, {
                  plans: h.plans.map((x, j) =>
                    j === n
                      ? {
                          ...x,
                          controlType: e.target.value as typeof p.controlType,
                        }
                      : x,
                  ),
                })
              }
            >
              {["미정", "제거", "대체", "공학적", "관리적", "보호구"].map(
                (x) => (
                  <option key={x}>{x}</option>
                ),
              )}
            </select>
          </label>
          <label>
            예정일
            <input
              type="date"
              value={p.due ?? ""}
              onChange={(e) =>
                change(h.id, {
                  plans: h.plans.map((x, j) =>
                    j === n ? { ...x, due: e.target.value || null } : x,
                  ),
                })
              }
            />
          </label>
          <button
            onClick={() =>
              window.confirm("이 초안의 계획을 제거할까요?") &&
              change(h.id, { plans: h.plans.filter((_, j) => j !== n) })
            }
          >
            계획 제거
          </button>
        </div>
      ))}
      <button
        disabled={h.plans.length >= 10}
        onClick={() =>
          change(h.id, {
            plans: [
              ...h.plans,
              {
                action: "",
                controlType: "미정",
                ownerNote: "",
                due: null,
                priorityNote: "",
                preconditions: "",
              },
            ],
          })
        }
      >
        빈 저감 계획 추가
      </button>
      <button
        onClick={() =>
          window.confirm(
            "이 위험행을 초안에서 제거할까요? 이전 저장본은 이력에 남습니다.",
          ) && onRemove()
        }
      >
        위험행 제거
      </button>
    </fieldset>
  );
}
