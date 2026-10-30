import { useEffect, useState } from "react";
import { api } from "./api";
import type { WorkStopEvent } from "./work-stop-types";
export function WorkStopHistory({
  path,
  version,
}: {
  path: string;
  version: number;
}) {
  const [page, setPage] = useState<{
      items: WorkStopEvent[];
      hasMore: boolean;
    }>({ items: [], hasMore: false }),
    [offset, setOffset] = useState(0),
    [tick, setTick] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setBusy(true);
    setPage({ items: [], hasMore: false });
    setError("");
    api<typeof page>(`${path}/history?offset=${offset}`)
      .then((r) => {
        if (active) setPage(r);
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
      <h2>변경하지 않는 기록 이력</h2>
      {error && (
        <p role="alert">
          {error}
          <button onClick={() => setTick((t) => t + 1)}>다시 조회</button>
        </p>
      )}
      {busy ? (
        <p>조회 중…</p>
      ) : (
        page.items.map((e) => (
          <details key={e.id}>
            <summary>
              v{e.version} · {e.event} · {e.actor_name} · audit UTC {e.at}
            </summary>
            <p>계정 ID {e.actor_id}</p>
            <p>{e.note}</p>
            <pre>{JSON.stringify(JSON.parse(e.snapshot), null, 2)}</pre>
          </details>
        ))
      )}
      <div className="form-actions">
        <button
          disabled={busy || offset === 0}
          onClick={() => {
            setBusy(true);
            setOffset((o) => o - 50);
          }}
        >
          이전 이력
        </button>
        <span>{Math.floor(offset / 50) + 1} 페이지</span>
        <button
          disabled={busy || !page.hasMore}
          onClick={() => {
            setBusy(true);
            setOffset((o) => o + 50);
          }}
        >
          다음 이력
        </button>
      </div>
    </section>
  );
}
