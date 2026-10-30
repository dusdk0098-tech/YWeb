import { useEffect, useState } from "react";
import { api, type Site } from "./api";
import type { TbmSession, TbmFull } from "./tbm-types";
import type { Page } from "./attendance-types";
import { TbmEditor } from "./TbmEditor";
export function TbmPanel({
  site,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [rows, setRows] = useState<TbmSession[]>([]),
    [more, setMore] = useState(false),
    [offset, setOffset] = useState(0),
    [tick, setTick] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [open, setOpen] = useState<{ record: TbmFull | null } | null>(null),
    [opening, setOpening] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setRows([]);
    setError("");
    api<Page<TbmSession>>(`/sites/${site.id}/tbm?offset=${offset}`)
      .then((r) => {
        if (active) {
          setRows(r.items);
          setMore(r.hasMore);
        }
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
  }, [site.id, offset, tick]);
  useEffect(
    () => () => {
      onDirtyChange(false);
      onBusyChange(false);
    },
    [onDirtyChange, onBusyChange],
  );
  async function openRecord(id: string) {
    if (opening) return;
    setOpening(true);
    onBusyChange(true);
    setError("");
    try {
      setOpen({ record: await api<TbmFull>(`/sites/${site.id}/tbm/${id}`) });
    } catch (e) {
      if (open) throw e;
      setError((e as Error).message);
    } finally {
      setOpening(false);
      onBusyChange(false);
    }
  }
  if (open)
    return (
      <TbmEditor
        key={open.record?.id || "new"}
        site={site}
        initial={open.record}
        onDirtyChange={onDirtyChange}
        onBusyChange={onBusyChange}
        onClose={() => {
          setOpen(null);
          setTick((t) => t + 1);
        }}
        onOpen={openRecord}
        onRevision={(next) => setOpen({ record: next })}
      />
    );
  return (
    <>
      <div className="section-head page-heading">
        <div>
          <p className="eyebrow">TOOLBOX MEETING</p>
          <h1>TBM 기록</h1>
          <p>담당자 수기 참여기록 · 관리자 기록 확정.</p>
        </div>
        {site.role !== "viewer" && (
          <button disabled={opening} onClick={() => setOpen({ record: null })}>
            + TBM 초안
          </button>
        )}
      </div>
      <section className="panel">
        <p className="notice">
          출역을 TBM 참여로 자동 처리하지 않습니다. 기록 확정은 신원
          확인·서명·법정 교육 이수 인증이 아닙니다.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {loading ? (
          <p>불러오는 중…</p>
        ) : (
          <ul className="meeting-list">
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  className="record"
                  disabled={opening}
                  onClick={() => openRecord(r.id)}
                >
                  <span>
                    <small>
                      {r.body.date} ·{" "}
                      {r.status === "draft" ? "초안" : "관리자가 기록 확정"}
                    </small>
                    <strong>{r.body.title}</strong>
                    <small>
                      버전 {r.version}
                      {r.parent_id ? " · 정정본" : ""}
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
            TBM 이전
          </button>
          <span>{offset / 50 + 1} 페이지</span>
          <button
            className="secondary"
            disabled={loading || opening || !more}
            onClick={() => setOffset(offset + 50)}
          >
            TBM 다음
          </button>
        </div>
      </section>
    </>
  );
}
