import { NarrativeCriteriaFields } from "./NarrativeCriteriaFields";
import { emptyNarrativeQuestions } from "../server/risk-narrative-labels";
import { ChecklistCriteriaFields } from "./ChecklistCriteriaFields";
import { useState } from "react";
import { api, type Site } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import type { MethodCriteria as RiskCriteria } from "../server/risk-methods";
import { ThreeLevelCriteriaFields } from "./ThreeLevelCriteriaFields";
import type { RiskCriteriaRecord } from "../server/risk-core";
import { CompanyPpeHistory } from "./CompanyPpeHistory";
export const emptyRiskCriteria: RiskCriteria = {
  name: "",
  method: "product",
  likelihood: ["", "", "", "", ""],
  severity: ["", "", "", ""],
  bands: [],
  rationale: "",
};
export function RiskCriteriaEditor({
  site,
  initial,
  onClose,
  onDirtyChange,
  onBusyChange,
  method = "product",
}: {
  method?: "product" | "three_level" | "checklist" | "narrative";
  site: Site;
  initial: RiskCriteriaRecord | null;
  onClose: () => void;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [row, setRow] = useState(initial),
    [body, setBody] = useState<RiskCriteria>(
      initial?.body ??
        (method === "product"
          ? emptyRiskCriteria
          : method === "narrative"
            ? { name: "", method: "narrative", rationale: "", questions: emptyNarrativeQuestions() }
          : method === "checklist"
            ? { name: "", method: "checklist", rationale: "", items: [] }
            : {
                name: "",
                method: "three_level",
                rationale: "",
                levels: Array.from({ length: 3 }, () => ({
                  id: crypto.randomUUID(),
                  label: "",
                  description: "",
                  criterionAcceptable: false,
                })),
              }),
    ),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [initialBody] = useState(body);
  const dirty =
      JSON.stringify(body) !== JSON.stringify(row?.body ?? initialBody) ||
      !!reason ||
      confirmed,
    guard = useDraftGuard(dirty, busy, onDirtyChange, onBusyChange),
    editable = site.role === "manager" && row?.status !== "confirmed",
    base = `/sites/${site.id}/risk-criteria`;
  async function save(action: "save" | "confirm" | "revise") {
    const path =
        base +
        (row ? `/${row.id}` : "") +
        (action === "save" ? "" : `/${action}`),
      value =
        action === "save"
          ? row
            ? { version: row.version, body, reason }
            : body
          : action === "confirm"
            ? { version: row!.version, reason, confirmHumanCriteria: confirmed }
            : { version: row!.version, reason };
    setBusy(true);
    setError("");
    try {
      const next = await api<RiskCriteriaRecord>(
        path,
        action === "save" && row ? "PUT" : "POST",
        value,
        guard.key(path, value),
      );
      setRow(next);
      setBody(next.body);
      setReason("");
      setConfirmed(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <button disabled={busy} onClick={() => guard.canLeave() && onClose()}>
        기준 목록
      </button>
      <h2>
        사람이 정의하는{" "}
        {body.method === "product"
          ? "수치 기준"
          : body.method === "three_level"
            ? "3단계 판단 기준"
            : body.method === "narrative" ? "핵심요인 서술형 기준" : "체크리스트 판단 기준"}{" "}
        · {row?.status === "confirmed" ? "확인된 불변 버전" : "초안"}
      </h2>
      <p>
        수치형은 산술, 3단계·체크리스트·서술형은 사람 판단 기록입니다. 법정 기본
        기준은 없습니다. 허용 표시는 사용자 설정값이며 안전 판정·작업 허가가
        아닙니다.
      </p>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy || !editable}>
        <label>
          기준 이름
          <input
            value={body.name}
            maxLength={200}
            onChange={(e) => setBody({ ...body, name: e.target.value })}
          />
        </label>
        {body.method === "product" ? (
          <>
            {(["likelihood", "severity"] as const).map((axis) => (
              <div key={axis}>
                <h3>
                  {axis === "likelihood" ? "가능성" : "중대성"} 단계 설명 (1부터
                  순서)
                </h3>
                {body[axis].map((value, i) => (
                  <label key={i}>
                    {i + 1}
                    <input
                      value={value}
                      maxLength={500}
                      onChange={(e) =>
                        setBody({
                          ...body,
                          [axis]: body[axis].map((x, j) =>
                            j === i ? e.target.value : x,
                          ),
                        })
                      }
                    />
                  </label>
                ))}
                <button
                  type="button"
                  disabled={body[axis].length < 2}
                  onClick={() =>
                    setBody({ ...body, [axis]: body[axis].slice(0, -1) })
                  }
                >
                  마지막 단계 제거
                </button>
                <button
                  type="button"
                  disabled={
                    body[axis].length >= (axis === "likelihood" ? 5 : 4)
                  }
                  onClick={() =>
                    setBody({ ...body, [axis]: [...body[axis], ""] })
                  }
                >
                  단계 추가
                </button>
              </div>
            ))}
            <h3>사용자 정의 곱 점수 구간</h3>
            {body.bands.map((b, i) => (
              <div key={i}>
                <label>
                  최소
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={b.min}
                    onChange={(e) =>
                      setBody({
                        ...body,
                        bands: body.bands.map((x, j) =>
                          j === i ? { ...x, min: Number(e.target.value) } : x,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  최대
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={b.max}
                    onChange={(e) =>
                      setBody({
                        ...body,
                        bands: body.bands.map((x, j) =>
                          j === i ? { ...x, max: Number(e.target.value) } : x,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  구간 이름
                  <input
                    maxLength={200}
                    value={b.label}
                    onChange={(e) =>
                      setBody({
                        ...body,
                        bands: body.bands.map((x, j) =>
                          j === i ? { ...x, label: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={b.criterionAcceptable}
                    onChange={(e) =>
                      setBody({
                        ...body,
                        bands: body.bands.map((x, j) =>
                          j === i
                            ? { ...x, criterionAcceptable: e.target.checked }
                            : x,
                        ),
                      })
                    }
                  />
                  사용자 기준상 허용 분류 (작업 허가 아님)
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setBody({
                      ...body,
                      bands: body.bands.filter((_, j) => i !== j),
                    })
                  }
                >
                  구간 제거
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={body.bands.length >= 20}
              onClick={() =>
                setBody({
                  ...body,
                  bands: [
                    ...body.bands,
                    { min: 1, max: 1, label: "", criterionAcceptable: false },
                  ],
                })
              }
            >
              빈 구간 추가
            </button>
          </>
        ) : body.method === "checklist" ? (
          <ChecklistCriteriaFields body={body} onChange={setBody} />
        ) : body.method === "narrative" ? (
          <NarrativeCriteriaFields body={body} onChange={setBody} />
        ) : (
          <ThreeLevelCriteriaFields body={body} onChange={setBody} />
        )}
        <label>
          적용 기준의 근거/설명
          <textarea
            maxLength={2000}
            value={body.rationale}
            onChange={(e) => setBody({ ...body, rationale: e.target.value })}
          />
        </label>
      </fieldset>
      {site.role === "manager" && (
        <>
          <label>
            변경·확인·개정 사유
            <input
              disabled={busy}
              value={reason}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {editable ? (
            <>
              <button
                disabled={
                  busy || (!!row && !reason.trim()) || (!row && !!reason)
                }
                onClick={() => save("save")}
              >
                초안 저장
              </button>
              {row && (
                <>
                  <label>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    내가 선택 방법의 모든 항목/단계/구간 설명과 적용 판단·근거를
                    검토했습니다. 안전·준법 승인이 아닙니다.
                  </label>
                  <button
                    disabled={
                      busy ||
                      !confirmed ||
                      !reason.trim() ||
                      JSON.stringify(body) !== JSON.stringify(row.body)
                    }
                    onClick={() => save("confirm")}
                  >
                    이 기준 버전 확인·고정
                  </button>
                </>
              )}
            </>
          ) : (
            <button
              disabled={busy || !reason.trim()}
              onClick={() => save("revise")}
            >
              고정본을 보존하고 새 기준 초안
            </button>
          )}
        </>
      )}
      {row && (
        <>
          <p>
            기준 ID {row.id} / version {row.version} / 이전{" "}
            {row.parent_id ?? "없음"}
          </p>
          <CompanyPpeHistory
            key={`${row.id}:${row.version}`}
            path={`${base}/${row.id}/events`}
            version={row.version}
          />
        </>
      )}
    </section>
  );
}
