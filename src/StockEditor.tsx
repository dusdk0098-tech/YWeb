import { StockMinimumEditor } from "./StockMinimumEditor";
import { Notice, TechDetails } from "./ui";
import { StockCostSource } from "./StockCostSource";
import { useEffect, useState } from "react";
import { api, type Site } from "./api";
import type { Page } from "./attendance-types";
import { useDraftGuard } from "./useDraftGuard";
import { StockHistory } from "./StockHistory";
import {
  stockKinds,
  stockWarning,
  type StockItem,
  type StockMovement,
} from "./stock-types";
type Form = {
  kind: Exclude<keyof typeof stockKinds, "reversal">;
  quantity: string;
  effectiveDate: string;
  reason: string;
};
export function StockEditor({
  site,
  initial,
  onDirtyChange,
  onBusyChange,
  onClose,
}: {
  site: Site;
  initial: StockItem;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
  onClose: () => void;
}) {
  const [record, setRecord] = useState(initial),
    [page, setPage] = useState<Page<StockMovement>>({
      items: [],
      hasMore: false,
    }),
    [offset, setOffset] = useState(0),
    [tick, setTick] = useState(0),
    [form, setForm] = useState<Form | null>(null),
    [reverse, setReverse] = useState<StockMovement | null>(null),
    [metadata, setMetadata] = useState<{
      name: string;
      unit: string;
      reason: string;
    } | null>(null),
    [history, setHistory] = useState(false),
    [minimums, setMinimums] = useState(false),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const guard = useDraftGuard(
      !!form || !!metadata,
      busy,
      onDirtyChange,
      onBusyChange,
    ),
    base = `/sites/${site.id}/stock-items/${record.id}`;
  useEffect(() => {
    let active = true;
    setLoading(true);
    api<Page<StockMovement>>(`${base}/movements?offset=${offset}`)
      .then((v) => {
        if (active) setPage(v);
      })
      .catch((e) => {
        if (active) {
          setPage({ items: [], hasMore: false });
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
  function start(target: StockMovement | null = null) {
    if (!guard.canLeave()) return;
    setMetadata(null);
    setReverse(target);
    setForm({
      kind: record.movementCount ? "receipt" : "opening",
      quantity: target?.quantity || "",
      effectiveDate: record.lastEffectiveDate || "",
      reason: "",
    });
    setError("");
  }
  async function save() {
    if (busy) return;
    const path = metadata
      ? ""
      : reverse
        ? `/movements/${reverse.id}/reverse`
        : "/movements";
    const body = metadata
      ? { version: record.version, ...metadata }
      : reverse
        ? {
            version: record.version,
            effectiveDate: form!.effectiveDate,
            reason: form!.reason,
          }
        : { version: record.version, ...form };
    setBusy(true);
    setError("");
    try {
      const next = await api<StockItem | { item: StockItem }>(
        base + path,
        metadata ? "PUT" : "POST",
        body,
        guard.key(base + path, body),
      );
      setRecord(
        metadata ? (next as StockItem) : (next as { item: StockItem }).item,
      );
      setForm(null);
      setReverse(null);
      setMetadata(null);
      setTick((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function cancel() {
    if (guard.canLeave()) {
      setForm(null);
      setMetadata(null);
      setReverse(null);
    }
  }
  if (minimums) return <StockMinimumEditor base={base} onDirtyChange={onDirtyChange} onBusyChange={onBusyChange} onClose={() => {
    setMinimums(false);
    setBusy(true);
    api<StockItem>(base).then(setRecord).catch(e => setError(e.message)).finally(() => setBusy(false));
  }}/>;
  return (
    <section>
      <button
        disabled={busy}
        onClick={() => {
          if (guard.canLeave()) onClose();
        }}
      >
        재고 목록
      </button>
      <h2>
        {record.name} · 잔량 {record.balance} {record.unit}
      </h2>
      <Notice summary="직접 입력하는 재고 기록입니다. 실물 확인이나 금액 평가는 하지 않습니다.">{stockWarning}</Notice>
      <button disabled={busy} onClick={() => { if (guard.canLeave()) { setForm(null); setReverse(null); setMetadata(null); setMinimums(true); } }}>최소재고 설정·현재 비교</button>
      <p>
        보존 이동{" "}
        {record.movementCount}/9000 (원본 {record.originalCount}/1000 · 역분개{" "}
        {record.reversalCount}/1000 · PPE 전용 {record.ppeReturnMovementCount||0}/7000) · 최근 효력일{" "}
        {record.lastEffectiveDate || "없음"}
      </p>
      <TechDetails><p>품목 ID {record.id} · v{record.version}</p></TechDetails>
      {error && (
        <p role="alert">
          {error} 입력을 유지했습니다. 버전 충돌이면 목록에서 최신본을 다시
          여세요.
        </p>
      )}
      <a href={"/api" + base + "/print"} target="_blank" rel="noreferrer">
        현재 수불 인쇄
      </a>
      <button
        disabled={busy || record.originalCount >= 1000}
        onClick={() => start()}
      >
        실제 이동·조정 기록
      </button>
      <button
        disabled={busy}
        onClick={() => {
          if (guard.canLeave()) {
            setForm(null);
            setReverse(null);
            setMetadata({ name: record.name, unit: record.unit, reason: "" });
          }
        }}
      >
        품목 정보 정정
      </button>
      <button disabled={busy} onClick={() => setHistory((v) => !v)}>
        메타 이력
      </button>
      {history && <StockHistory base={base} tick={tick} />}
      {metadata && (
        <fieldset disabled={busy}>
          <legend>사유 있는 정보 정정</legend>
          <label>
            품목명
            <input
              maxLength={200}
              value={metadata.name}
              onChange={(e) =>
                setMetadata({ ...metadata, name: e.target.value })
              }
            />
          </label>
          <label>
            수량 단위
            <input
              disabled={record.movementCount > 0}
              maxLength={30}
              value={metadata.unit}
              onChange={(e) =>
                setMetadata({ ...metadata, unit: e.target.value })
              }
            />
          </label>
          <label>
            정정 사유
            <textarea
              maxLength={1000}
              value={metadata.reason}
              onChange={(e) =>
                setMetadata({ ...metadata, reason: e.target.value })
              }
            />
          </label>
          <p>
            첫 이동 뒤 단위 변환은 지원하지 않습니다. 과거 이동의 품목명/단위는
            바뀌지 않습니다.
          </p>
          <button onClick={() => void save()}>정보 저장</button>
          <button onClick={cancel}>취소</button>
        </fieldset>
      )}
      {form && (
        <fieldset disabled={busy}>
          <legend>{reverse ? "선택 원본 전체 역분개" : "새 수기 이동"}</legend>
          {reverse ? (
            <>
              <p>
                원본 #{reverse.sequence} ·{" "}
                {stockKinds[reverse.kind as keyof typeof stockKinds]} ·{" "}
                {reverse.quantity} {record.unit} 전량을 반대 이동으로
                추가합니다. 부분 역분개/역분개의 역분개는 지원하지 않습니다.
              </p>
              <p>
                원본 입고가 이미 사용됐다면 먼저 종속 오류 이동을 역분개하거나
                실제 반납 사실을 기록해야 합니다. 허위 입고/조정으로 우회하지
                마세요.
              </p>
            </>
          ) : (
            <>
              <label>
                이동 유형
                <select
                  value={form.kind}
                  onChange={(e) =>
                    setForm({ ...form, kind: e.target.value as Form["kind"] })
                  }
                >
                  {(Object.keys(stockKinds) as (keyof typeof stockKinds)[])
                    .filter(
                      (k) =>
                        k !== "reversal" &&
                        (k !== "opening" || !record.movementCount),
                    )
                    .map((k) => (
                      <option key={k} value={k}>
                        {stockKinds[k]}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                양수 수량
                <input
                  inputMode="decimal"
                  value={form.quantity}
                  onChange={(e) =>
                    setForm({ ...form, quantity: e.target.value })
                  }
                />
              </label>
            </>
          )}
          <label>
            효력일
            <input
              type="date"
              value={form.effectiveDate}
              onChange={(e) =>
                setForm({ ...form, effectiveDate: e.target.value })
              }
            />
          </label>
          <label>
            이동 사실·사유
            <textarea
              maxLength={1000}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            />
          </label>
          <p>
            과거로 끼워 넣지 않습니다. 같은 날은 입력 순서대로 누계가 변합니다.
            기록 시각은 서버가 별도 저장합니다. 현재 실사 수량을 덮어쓰지 않고
            증감 사실을 기록하세요.
          </p>
          <button disabled={!form.reason.trim()} onClick={() => void save()}>
            {reverse ? "전량 역분개 기록" : "이동 저장"}
          </button>
          <button onClick={cancel}>취소</button>
        </fieldset>
      )}
      {loading ? (
        <p>이동 조회 중</p>
      ) : (
        page.items.map((m) => (
          <article key={m.id}>
            <h3>
              #{m.sequence} {stockKinds[m.kind as keyof typeof stockKinds]} ·{" "}
              {m.direction === 1 ? "+" : "−"}
              {m.quantity} {m.item_snapshot.unit}
            </h3>
            <p>
              효력일 {m.effective_date} · 기록 {m.recorded_at} · 당시 품목{" "}
              {m.item_snapshot.name} · 이후 잔량 {m.balance_after}
            </p>
            <p>{m.reason}</p>
            <p>이동 ID {m.id}</p>
            {m.costReceiptId && <StockCostSource siteId={site.id} receiptId={m.costReceiptId} disabled={busy}/>}
            {m.ppeRecordId && (
              <p>
                보호구 원장 {m.ppeRecordId} 연결 · 반납/전용취소는 업체·소속·보호구
                메뉴에서 기록하세요.
              </p>
            )}
            <p>
              기록 계정 {m.actor_name} ({m.actor_id})
            </p>
            {m.reverses_id && <p>역분개 원본 {m.reverses_id}</p>}
            {m.reversedBy && (
              <p>전체 역분개 기록 {m.reversedBy} 존재 (원본 보존)</p>
            )}
            <details>
              <summary>불변 이동 해시</summary>
              {m.hash}
            </details>
            <button
              disabled={
                busy ||
                m.kind === "reversal" ||
                !!m.reversedBy ||
                !!m.ppeRecordId ||
                !!m.costReceiptId ||
                record.reversalCount >= 1000
              }
              onClick={() => start(m)}
            >
              이 원본 전체 역분개
            </button>
          </article>
        ))
      )}
      <button
        disabled={busy || loading || offset === 0}
        onClick={() => setOffset((v) => v - 50)}
      >
        이전50개
      </button>
      <button
        disabled={busy || loading || !page.hasMore}
        onClick={() => setOffset((v) => v + 50)}
      >
        다음50개
      </button>
    </section>
  );
}
