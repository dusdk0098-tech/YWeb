import { useEffect, useRef, useState } from "react";
import { api, type Meeting, type Site } from "./api";
import { MinutesFollowupBoard } from "./MinutesFollowupBoard";
export function Minutes({
  site,
  open,
}: {
  site: Site;
  open: (m: Meeting | null) => void;
}) {
  const [items, setItems] = useState<Meeting[]>([]),
    [offset, setOffset] = useState(0),
    [more, setMore] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [board, setBoard] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    setOffset(0);
  }, [site.id]);
  useEffect(() => {
    const generation = ++request.current;
    setBusy(true);
    setItems([]);
    setError("");
    api<{ items: Meeting[]; hasMore: boolean }>(
      `/sites/${site.id}/minutes?offset=${offset}`,
    )
      .then((r) => {
        if (generation === request.current) {
          setItems(r.items);
          setMore(r.hasMore);
        }
      })
      .catch((e) => {
        if (generation === request.current) setError(e.message);
      })
      .finally(() => {
        if (generation === request.current) setBusy(false);
      });
    return () => {
      request.current++;
    };
  }, [site.id, offset]);
  if (board) return <MinutesFollowupBoard site={site} onClose={() => setBoard(false)} />;
  return (
    <>
      <div className="section-head page-heading">
        <div>
          <p className="eyebrow">MEETING MINUTES</p>
          <h1>회의록</h1>
          <p>회의의 결정을 다음 행동으로 이어갑니다.</p>
        </div>
        {site.role !== "viewer" && (
          <button onClick={() => open(null)}>+ 새 회의록</button>
        )}
      </div>
      <button className="secondary" onClick={() => setBoard(true)}>
        후속조치 보드
      </button>
      <section className="panel">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {busy ? (
          <p>불러오는 중…</p>
        ) : items.length === 0 ? (
          <div className="empty">
            <h2>아직 작성된 회의록이 없습니다.</h2>
            <p>첫 회의를 기록해 보세요.</p>
          </div>
        ) : (
          <ul className="meeting-list">
            {items.map((m) => (
              <li key={m.id}>
                <button className="record" onClick={() => open(m)}>
                  <span>
                    <small>
                      {m.type} · {m.date}
                    </small>
                    <strong>{m.title}</strong>
                    <small>
                      {m.location} · 버전 {m.version} · {m.status === "finalized" ? "관리자 기록 확정" : "초안"}{m.parentId ? " · 정정본" : ""}{m.successorId ? " · 후속 정정본 있음" : ""}
                    </small>
                  </span>
                  <span>열기 →</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="form-actions">
          <button
            className="secondary"
            disabled={busy || offset === 0}
            onClick={() => setOffset(offset - 50)}
          >
            이전
          </button>
          <span>{Math.floor(offset / 50) + 1} 페이지</span>
          <button
            className="secondary"
            disabled={busy || !more}
            onClick={() => setOffset(offset + 50)}
          >
            다음
          </button>
        </div>
      </section>
    </>
  );
}
