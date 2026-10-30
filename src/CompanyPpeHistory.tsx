import { useEffect, useState } from "react";
import { api } from "./api";
export function CompanyPpeHistory({
  path,
  version,
}: {
  path: string;
  version: number;
}) {
  const [page, setPage] = useState<{
      items: {
        id: number;
        version: number;
        actor_name: string;
        actor_id: string;
        at: string;
        reason: string;
        snapshot: string;
      }[];
      hasMore: boolean;
    }>({ items: [], hasMore: false }),
    [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    setPage({ items: [], hasMore: false });
    setBusy(true);
    setError("");
    api<typeof page>(`${path}/events?offset=${offset}`)
      .then((v) => {
        if (active) setPage(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [path, version, offset, tick]);
  return (
    <section className="panel">
      <h3>당시 기록·정정 이력</h3>
      {error && (
        <p role="alert">
          {error}
          <button onClick={() => setTick((t) => t + 1)}>다시 조회</button>
        </p>
      )}
      {busy ? (
        <p>조회 중…</p>
      ) : (
        page.items.map((v) => (
          <details key={v.id}>
            <summary>
              v{v.version} · {v.actor_name} · {v.at}
            </summary>
            <p>계정 {v.actor_id}</p>
            <p>{v.reason}</p>
            <pre>{v.snapshot}</pre>
          </details>
        ))
      )}
      <button
        disabled={busy || !offset}
        onClick={() => {
          setBusy(true);
          setOffset((o) => o - 50);
        }}
      >
        이전 이력
      </button>
      <span>{offset / 50 + 1} 페이지</span>
      <button
        disabled={busy || !page.hasMore}
        onClick={() => {
          setBusy(true);
          setOffset((o) => o + 50);
        }}
      >
        다음 이력
      </button>
    </section>
  );
}
