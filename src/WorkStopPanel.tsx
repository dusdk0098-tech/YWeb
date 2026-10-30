import { useEffect, useState } from "react";
import { api, type Site, type User } from "./api";
import type { Page } from "./attendance-types";
import {
  workStopLabels,
  type WorkStopRecord,
  type WorkStopStatus,
} from "./work-stop-types";
import { WorkStopEditor } from "./WorkStopEditor";
export function WorkStopPanel({
  site,
  user,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  user: User;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [page, setPage] = useState<Page<WorkStopRecord>>({
      items: [],
      hasMore: false,
    }),
    [offset, setOffset] = useState(0),
    [filter, setFilter] = useState(""),
    [tick, setTick] = useState(0),
    [loading, setLoading] = useState(true),
    [opening, setOpening] = useState(false),
    [error, setError] = useState(""),
    [open, setOpen] = useState<{ record: WorkStopRecord | null } | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setPage({ items: [], hasMore: false });
    setError("");
    api<Page<WorkStopRecord>>(
      `/sites/${site.id}/work-stops?offset=${offset}${filter ? "&status=" + filter : ""}`,
    )
      .then((r) => {
        if (active) setPage(r);
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
  }, [site.id, offset, filter, tick]);
  useEffect(
    () => () => {
      onDirtyChange(false);
      onBusyChange(false);
    },
    [onDirtyChange, onBusyChange],
  );
  async function view(id: string) {
    if (opening) return;
    setOpening(true);
    onBusyChange(true);
    setError("");
    try {
      setOpen({
        record: await api<WorkStopRecord>(`/sites/${site.id}/work-stops/${id}`),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOpening(false);
      onBusyChange(false);
    }
  }
  if (open)
    return (
      <WorkStopEditor
        key={open.record?.id || "new"}
        site={site}
        user={user}
        initial={open.record}
        onDirtyChange={onDirtyChange}
        onBusyChange={onBusyChange}
        onClose={() => {
          setOpen(null);
          setTick((t) => t + 1);
        }}
      />
    );
  return (
    <>
      <div className="section-head page-heading">
        <div>
          <p className="eyebrow">REPORT & FOLLOW-UP</p>
          <h1>작업중지 요청 · 수기 기록</h1>
          <p>요청/확인/중지/개선/재개에 관한 수기 기록입니다.</p>
        </div>
        {site.role !== "viewer" && (
          <button disabled={opening} onClick={() => setOpen({ record: null })}>
            + 요청 접수 기록
          </button>
        )}
      </div>
      <section className="panel">
        <p className="notice">
          실제 작업중지/재개 명령·안전 허가·외부 알림이 아닙니다. 긴급 상황은
          현장의 실제 대응 절차를 별도로 따르세요.
        </p>
        <label>
          기록 상태 필터
          <select
            value={filter}
            disabled={opening}
            onChange={(e) => {
              setFilter(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">전체</option>
            {Object.entries(workStopLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {loading ? (
          <p>불러오는 중…</p>
        ) : (
          <ul className="meeting-list">
            {page.items.map((r) => (
              <li key={r.id}>
                <button
                  className="record"
                  disabled={opening}
                  onClick={() => view(r.id)}
                >
                  <span>
                    <small>
                      {r.original.body.observedLocal} ·{" "}
                      {workStopLabels[r.status as WorkStopStatus]}
                    </small>
                    <strong>{r.original.body.work}</strong>
                    <small>
                      {r.original.body.location} · 버전 {r.version}
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
            disabled={loading || opening || offset === 0}
            onClick={() => setOffset(offset - 50)}
          >
            요청 이전
          </button>
          <span>{offset / 50 + 1} 페이지</span>
          <button
            className="secondary"
            disabled={loading || opening || !page.hasMore}
            onClick={() => setOffset(offset + 50)}
          >
            요청 다음
          </button>
        </div>
      </section>
    </>
  );
}
