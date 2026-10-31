import { useEffect, useState } from "react";
import { Notice } from "./ui";
import { api, type Site } from "./api";
import type { Page } from "./attendance-types";
import { noticeStatus, type NoticeView } from "./notice-types";
import { NoticeEditor } from "./NoticeEditor";
export function NoticesPanel({
  site,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [rows, setRows] = useState<Page<NoticeView>>({
      items: [],
      hasMore: false,
    }),
    [offset, setOffset] = useState(0),
    [tick, setTick] = useState(0),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [open, setOpen] = useState<{ record: NoticeView | null } | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<Page<NoticeView>>(`/sites/${site.id}/notices?offset=${offset}`)
      .then((r) => {
        if (active) setRows(r);
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
  async function view(id: string) {
    if (busy) return;
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      setOpen({
        record: await api<NoticeView>(`/sites/${site.id}/notices/${id}`),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  if (open)
    return (
      <NoticeEditor
        key={open.record?.id || "new"}
        site={site}
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
      <h1>현장 계정 공지</h1>
      <Notice summary="공지는 지정한 계정에게만 보입니다. 외부로 알림을 보내지 않습니다.">
        관리자는 현장 전체 공지와 수신 대상/계정 확인을 관리합니다. 일반 계정은
        자신에게 지정된 게시/과거 공지만 볼 수 있습니다. 근로자 본인 확인·숙지
        증명·외부 알림이 아닙니다.
      </Notice>
      {site.role === "manager" && (
        <button disabled={busy} onClick={() => setOpen({ record: null })}>
          새 공지 초안
        </button>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {loading ? (
        <p>불러오는 중…</p>
      ) : (
        <section className="panel">
          {rows.items.map((r) => (
            <article key={r.id}>
              <h2>{r.content.title}</h2>
              <p>
                {noticeStatus[r.status]} · 적용일 표기 {r.content.applyDate} ·{" "}
                {r.ownAck ? "내 계정 확인됨" : "내 계정 확인 없음"}
              </p>
              <button disabled={busy} onClick={() => view(r.id)}>
                공지 열기
              </button>
            </article>
          ))}
          {!rows.items.length && <p>조회할 공지가 없습니다.</p>}
        </section>
      )}
      <button
        disabled={busy || loading || !offset}
        onClick={() => setOffset(offset - 50)}
      >
        이전 공지
      </button>
      <button
        disabled={busy || loading || !rows.hasMore}
        onClick={() => setOffset(offset + 50)}
      >
        다음 공지
      </button>
    </>
  );
}
