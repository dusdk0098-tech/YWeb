import { useState } from "react";
import { api, type Site } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import type { CostPeriod } from "./cost-types";
import type { CostBatchPreview } from "../server/cost-batch";
const header = "categoryId\tspendDate\tdescription\tquantity\tunitPriceWon";
type Receipt = {
  period: CostPeriod;
  createdIds: string[];
  count: number;
  batchAmount: string;
  previewDigest: string;
};
export function CostBatchImport({
  site,
  initial,
  onDirtyChange,
  onBusyChange,
  onClose,
  onSaved,
}: {
  site: Site;
  initial: CostPeriod;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
  onClose: () => void;
  onSaved: (v: CostPeriod) => void;
}) {
  const [period, setPeriod] = useState(initial),
    [tsv, setTsv] = useState(""),
    [preview, setPreview] = useState<CostBatchPreview | null>(null),
    [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [receipt, setReceipt] = useState<Receipt | null>(null);
  const guard = useDraftGuard(!!tsv, busy, onDirtyChange, onBusyChange),
    base = `/sites/${site.id}/cost-periods/${period.id}`;
  async function review() {
    if (busy) return;
    setBusy(true);
    setError("");
    setPreview(null);
    setAck(false);
    try {
      setPreview(
        await api<CostBatchPreview>(base + "/expense-batch/preview", "POST", {
          version: period.version,
          tsv,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    if (busy) return;
    setBusy(true);
    setError("");
    setPreview(null);
    setAck(false);
    try {
      const next = await api<CostPeriod>(base);
      setPeriod(next);
      onSaved(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (busy || !preview?.digest) return;
    if (
      !window.confirm(
        `검토한 ${preview.rows.length}행을 모두 새 지출로 저장할까요? 자동 중복 제거는 없습니다.`,
      )
    )
      return;
    const body = {
        version: period.version,
        tsv,
        previewDigest: preview.digest,
        acknowledgeDuplicates: ack,
      },
      path = base + "/expense-batch/commit";
    setBusy(true);
    setError("");
    try {
      const next = await api<Receipt>(
        path,
        "POST",
        body,
        guard.key(path, body),
      );
      setPeriod(next.period);
      onSaved(next.period);
      setReceipt(next);
      setTsv("");
      setPreview(null);
      setAck(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <button
        disabled={busy}
        onClick={() => {
          if (guard.canLeave()) onClose();
        }}
      >
        비용 원장으로
      </button>
      <h2>
        TSV 지출 일괄 입력 검토 · {period.month} v{period.version}
      </h2>
      <p>
        현재 현장 관리자의 작성 중 원장에만 최대100행을 추가합니다. 미리보기는
        지출을 저장하지 않으며 오류가 있으면 전체 저장하지 않습니다. 수량
        소수6자리, 단가 양수 원 단위 정수, 반올림 없음. 과거 고정밀
        원본/스프레드시트 파일은 이관하지 않습니다.
      </p>
      <p>
        첫 행은 아래 고정 헤더 그대로, 셀은 탭·행은 LF/CRLF입니다. BOM/빈 행/셀
        내부 탭·개행/CSV 인용 escape는 지원하지 않습니다. 따옴표와 =로 시작한
        설명은 문자 그대로이며 수식으로 실행하지 않습니다. UTF-8 100KiB 제한, 끝
        개행1개 허용.
      </p>
      <pre>{header}</pre>
      <h3>현재 원장의 항목 ID 매핑 (이름 추측 없음)</h3>
      <ul>
        {period.categories.map((c) => (
          <li key={c.id}>
            {c.label} — <code>{c.id}</code>
          </li>
        ))}
      </ul>
      <fieldset disabled={busy}>
        <label>
          붙여넣을 비용 TSV
          <textarea
            rows={12}
            maxLength={102400}
            value={tsv}
            onChange={(e) => {
              setTsv(e.target.value);
              setPreview(null);
              setAck(false);
              setReceipt(null);
            }}
          />
        </label>
        <button
          disabled={!tsv || period.status !== "open"}
          onClick={() => void review()}
        >
          저장 없이 TSV 검토
        </button>
        <button onClick={() => void refresh()}>
          입력 유지하고 원장 새로 조회
        </button>
      </fieldset>
      {period.status !== "open" && (
        <p>
          현재 마감 상태입니다. 검토/새 저장 불가. 원장 정책에 따른 명시적
          재개가 필요합니다.
        </p>
      )}
      {busy && <p role="status">처리 중…</p>}
      {error && (
        <p role="alert">
          {error} TSV 입력은 유지했습니다. 응답 유실 시 같은 입력/검토본으로
          재시도하면 같은 요청 영수증을 확인합니다. 원장 버전 충돌이면 새로 조회
          후 재검토하세요.
        </p>
      )}
      {receipt && (
        <aside>
          <h3>일괄 저장 영수증</h3>
          <p>
            {receipt.count}행 · 추가 금액 {receipt.batchAmount}원 · 결과 원장 v
            {receipt.period.version}
          </p>
          <p>검토 지문 {receipt.previewDigest}</p>
          <details>
            <summary>생성된 지출 ID</summary>
            <ul>
              {receipt.createdIds.map((id) => (
                <li key={id}>{id}</li>
              ))}
            </ul>
          </details>
        </aside>
      )}
      {preview && (
        <>
          <h3>행별 검토</h3>
          {preview.errors.map((e, i) => (
            <p role="alert" key={i}>
              {e.line ? `${e.line}행` : "전체"}: {e.message}
            </p>
          ))}
          <p>
            추가 합계 {preview.batchAmount ?? "계산 불가"}원 · 저장 후 현재 지출{" "}
            {preview.projected?.total.current ?? "계산 불가"}원 · 저장 후 누계{" "}
            {preview.projected?.total.cumulative ?? "계산 불가"}원
          </p>
          <table>
            <thead>
              <tr>
                <th>행/설명</th>
                <th>항목/날짜</th>
                <th>수량 × 단가 = 금액</th>
                <th>경고</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((r) => (
                <tr key={r.line}>
                  <td>
                    {r.line} · {r.expense.description}
                  </td>
                  <td>
                    {r.expense.categoryId}
                    <br />
                    {r.expense.spendDate}
                  </td>
                  <td>
                    {r.expense.quantity} × {r.expense.unitPriceWon} ={" "}
                    {r.expense.amount}
                  </td>
                  <td>
                    {r.priorPeriod ? "원장 월 이전 날짜. " : ""}
                    {r.duplicateLines.length
                      ? `입력 내 같은 내용 ${r.duplicateLines.join(",")}행. `
                      : ""}
                    {r.existingActive || r.existingCancelled
                      ? `기존 동일 내용 유효 ${r.existingActive} / 취소 ${r.existingCancelled}행. `
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.hasDuplicates && (
            <label>
              <input
                type="checkbox"
                checked={ack}
                disabled={busy}
                onChange={(e) => setAck(e.target.checked)}
              />
              중복 경고를 확인했으며 각 행은 실제 별도 지출로 모두 추가합니다
              (자동 제거 없음)
            </label>
          )}
          <button
            disabled={
              busy ||
              !preview.digest ||
              !!preview.errors.length ||
              (preview.hasDuplicates && !ack) ||
              period.status !== "open"
            }
            onClick={() => void commit()}
          >
            검토한 지출 전체 저장
          </button>
        </>
      )}
    </section>
  );
}
