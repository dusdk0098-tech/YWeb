import { useEffect, useState } from "react";
import { api } from "./api";
import type { Page } from "./attendance-types";
type Event = {
  id: number;
  version: number;
  event: string;
  actor_name: string;
  actor_id: string;
  at: string;
  note: string;
};
export function WorkPlanHistory({
  base,
  version,
}: {
  base: string;
  version: number;
}) {
  const [page, setPage] = useState<Page<Event>>({ items: [], hasMore: false }),
    [offset, setOffset] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    api<Page<Event>>(`${base}/events?offset=${offset}`)
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
  }, [base, version, offset]);
  return (
    <section>
      <h3>처리 메타 이력</h3>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p>조회 중</p>
      ) : (
        page.items.map((e) => (
          <p key={e.id}>
            v{e.version} {e.event} · {e.actor_name} ({e.actor_id}) · {e.at} ·{" "}
            {e.note}
          </p>
        ))
      )}
      <button
        disabled={loading || !offset}
        onClick={() => setOffset((v) => v - 50)}
      >
        이전 50
      </button>
      <button
        disabled={loading || !page.hasMore}
        onClick={() => setOffset((v) => v + 50)}
      >
        다음 50
      </button>
    </section>
  );
}
