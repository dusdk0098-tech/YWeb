import { useEffect, useState } from "react";
import { api, type Site } from "./api";
import type { CostSearchResult, CostSearchItem } from "../server/cost-search";
import { useDraftGuard } from "./useDraftGuard";
const noDirty = () => {};
const empty = {
  monthFrom: "",
  monthTo: "",
  dateFrom: "",
  dateTo: "",
  status: "all",
  text: "",
};
export function CostSearch({
  site,
  onClose,
  onOpen,
  onBusyChange,
}: {
  site: Site;
  onClose: () => void;
  onOpen: (row: CostSearchItem) => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const [form, setForm] = useState(empty),
    [applied, setApplied] = useState(empty),
    [offset, setOffset] = useState(0),
    [tick, setTick] = useState(0),
    [report, setReport] = useState<CostSearchResult | null>(null),
    [loading, setLoading] = useState(false),
    [opening, setOpening] = useState(false),
    [error, setError] = useState("");
  const busy = loading || opening;
  useDraftGuard(false, busy, noDirty, onBusyChange);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setReport(null);
    const query = new URLSearchParams({ offset: String(offset) });
    for (const [k, v] of Object.entries(applied)) if (v) query.set(k, v);
    api<CostSearchResult>(
      `/sites/${site.id}/cost-expense-search?` + query.toString(),
    )
      .then((r) => {
        if (active) setReport(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [site.id, applied, offset, tick]);
  function edit(key: keyof typeof empty, value: string) {
    setForm((v) => ({ ...v, [key]: value }));
    setReport(null);
    setError("");
  }
  async function open(row: CostSearchItem) {
    if (busy) return;
    setOpening(true);
    setError("");
    try {
      await onOpen(row);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOpening(false);
    }
  }
  return (
    <section className="panel">
      <button disabled={busy} onClick={onClose}>
        사용내역 목록으로
      </button>
      <h2>현재 현장 전체 월 지출 검색</h2>
      <p>
        현재 manager 권한의 이 현장만 검색합니다. 귀속 월은 원장 월이고 지출일은
        입력한 거래 날짜로 서로 다를 수 있습니다. 현재 유효/취소 상태를 조회하며
        과거 시점 재현이나 월간 이월·금액 합계를 만들지 않습니다.
      </p>
      <fieldset disabled={busy}>
        <legend>포함 범위 (빈 날짜는 제한 없음)</legend>
        {(
          [
            ["monthFrom", "귀속 월 시작", "month"],
            ["monthTo", "귀속 월 끝", "month"],
            ["dateFrom", "지출일 시작", "date"],
            ["dateTo", "지출일 끝", "date"],
          ] as const
        ).map(([k, label, type]) => (
          <label key={k}>
            {label}
            <input
              type={type}
              value={form[k]}
              onChange={(e) => edit(k, e.target.value)}
            />
          </label>
        ))}
        <label>
          지출 상태
          <select
            value={form.status}
            onChange={(e) => edit("status", e.target.value)}
          >
            <option value="all">유효와 취소 모두</option>
            <option value="active">현재 유효</option>
            <option value="cancelled">현재 취소</option>
          </select>
        </label>
        <label>
          설명에 포함된 문자 (기호도 문자 그대로)
          <input
            maxLength={100}
            value={form.text}
            onChange={(e) => edit("text", e.target.value)}
          />
        </label>
        <p>
          % · _ · 역슬래시는 패턴이 아닙니다. ASCII 영문 대소문자는 구분하지
          않으며 모든 언어의 대소문자 변환/유사어 검색은 아닙니다.
        </p>
        <button
          onClick={() => {
            setLoading(true);
            setApplied({ ...form });
            setOffset(0);
            setTick((t) => t + 1);
          }}
        >
          조건으로 지출 검색
        </button>
      </fieldset>
      {busy && <p role="status">검색/원장 조회 중…</p>}
      {error && (
        <p role="alert">
          {error} 이전 결과는 재사용하지 않습니다. 조건/권한을 확인하고 검색
          버튼으로 다시 조회하세요.
        </p>
      )}
      {report && (
        <>
          <p>
            조회 {report.generatedAt} · 현재 페이지 {report.items.length}행
            (최대50). 전체 건수/금액 합계가 아닙니다.
          </p>
          {report.items.length === 0 && (
            <p>
              현재 조건/페이지에 일치하는 지출이 없습니다. 자료 미존재/법적
              적합성을 판단하지 않습니다.
            </p>
          )}
          {report.items.map((r) => (
            <article key={r.id}>
              <h3>{r.description}</h3>
              <p>
                귀속 월 {r.periodMonth} · 원장{" "}
                {r.periodStatus === "open" ? "작성 중" : "마감"} v
                {r.periodVersion} · 지출일 {r.spendDate}
              </p>
              <p>
                항목 {r.categoryLabel} ({r.categoryId}) · {r.quantity} ×{" "}
                {r.unitPriceWon} = {r.amount}원 ·{" "}
                {r.status === "active"
                  ? "현재 유효"
                  : "현재 취소 (원장 합계 제외)"}
              </p>
              <p>
                지출 ID {r.id} v{r.version}
              </p>
              {r.childOfSplitId && (
                <p>
                  분할 자식 출처 {r.childOfSplitId} ·{" "}
                  {r.childSplitStatus === "active"
                    ? "분할 적용"
                    : "되돌림 기록 있음"}
                </p>
              )}
              {r.activeSourceSplitId && (
                <p>현재 적용된 원행 분할 {r.activeSourceSplitId}</p>
              )}
              {!!r.hasSourceSplitHistory && !r.activeSourceSplitId && (
                <p>
                  이 원행에 과거 분할 이력이 있습니다. 원장의 분할 이력에서
                  확인하세요.
                </p>
              )}
              <button disabled={busy} onClick={() => void open(r)}>
                이 지출 ID와 귀속 원장 열기
              </button>
            </article>
          ))}
          <p>
            버튼은 귀속 원장을 열고 정확한 지출 ID의 현재 조회 카드를 표시합니다. 검색 이후 버전/취소 상태가 달라질 수 있으며 행을 자동 수정하거나 스크롤 성공을 주장하지 않습니다.
          </p>
          <button
            disabled={busy || offset === 0}
            onClick={() => {
              setLoading(true);
              setOffset(offset - 50);
            }}
          >
            이전 검색 50행
          </button>
          <button
            disabled={busy || !report.hasMore}
            onClick={() => {
              setLoading(true);
              setOffset(offset + 50);
            }}
          >
            다음 검색 50행
          </button>
        </>
      )}
    </section>
  );
}
