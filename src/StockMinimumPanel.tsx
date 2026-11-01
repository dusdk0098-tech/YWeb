import { useEffect, useState } from "react";
import { api } from "./api";
import { StockMinimumSummary } from "./StockMinimumSummary";
import { minimumLabels, minimumWarning, type MinimumPage } from "./stock-minimum-types";
export function StockMinimumPanel({ siteId, onOpen, onClose, disabled }: {
  siteId: string; onOpen: (id: string) => void; onClose: () => void; disabled: boolean;
}) {
  const [offset, setOffset] = useState(0), [tick, setTick] = useState(0),
    [page, setPage] = useState<MinimumPage | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true; setLoading(true); setError(""); setPage(null);
    api<MinimumPage>(`/sites/${siteId}/stock-minimums?offset=${offset}`)
      .then(v => { if (active) setPage(v); }).catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [siteId, offset, tick]);
  return <section><h2>현재 최소재고 비교</h2><p>{minimumWarning}</p>
    <p>설정 이력이 있는 품목만 이름·ID 순서로 10개씩 비교합니다. 해제된 품목도 포함합니다. 아래 개수는 이번 페이지뿐이며 현장 전체 부족 합계가 아닙니다. 미설정 품목은 기존 재고 목록에서 선택하세요. 페이지 사이에 기록이 바뀔 수 있습니다.</p>
    <button disabled={disabled} onClick={onClose}>재고 목록</button>
    <button disabled={disabled || loading} onClick={() => setTick(v => v + 1)}>현재 페이지 다시 조회</button>
    {error && <p role="alert">{error} 비교 결과를 표시하지 않았습니다.</p>}
    {loading && <p>조회 중</p>}
    {page && <><p>전체 설정 이력 품목 {page.totalConfiguredItems}개 · 이번 페이지 {page.items.length}개 · 시작 위치 {page.offset + 1} · 조회 {page.queriedAt}</p>
      <p>이번 페이지: {Object.entries(page.pageCounts).map(([key, count]) => `${minimumLabels[key as keyof typeof minimumLabels]} ${count}`).join(" / ")}</p>
      {page.items.map(row => <article key={row.item.id}><h3>{row.item.name} · {row.item.unit}</h3><p>{row.item.id}</p><StockMinimumSummary record={row}/><button disabled={disabled} onClick={() => onOpen(row.item.id)}>품목 상세·수불·설정</button></article>)}
      <button disabled={disabled || offset === 0} onClick={() => setOffset(v => Math.max(0, v - 10))}>이전 10</button>
      <button disabled={disabled || !page.hasMore} onClick={() => setOffset(v => v + 10)}>다음 10</button>
    </>}
  </section>;
}
