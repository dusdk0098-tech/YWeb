import { useEffect, useState } from "react";
import { api, type Site, type User } from "./api";
import type { Page } from "./attendance-types";
import { WorkPlanEditor } from "./WorkPlanEditor";
import {
  workPlanWarning,
  type WorkPlan,
  type WorkPlanListItem,
} from "./work-plan-types";
export function WorkPlanPanel({
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
  const [page, setPage] = useState<Page<WorkPlanListItem>>({
      items: [],
      hasMore: false,
    }),
    [offset, setOffset] = useState(0),
    [tick, setTick] = useState(0),
    [record, setRecord] = useState<WorkPlan | null | undefined>(undefined),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    api<Page<WorkPlanListItem>>(`/sites/${site.id}/work-plans?offset=${offset}`)
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
  }, [site.id, offset, tick]);
  async function view(id: string) {
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      setRecord(await api<WorkPlan>(`/sites/${site.id}/work-plans/${id}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  if (record !== undefined)
    return (
      <WorkPlanEditor
        key={record?.id || "new"}
        site={site}
        user={user}
        initial={record}
        onDirtyChange={onDirtyChange}
        onBusyChange={onBusyChange}
        onRevision={setRecord}
        onClose={() => {
          setRecord(undefined);
          setTick((v) => v + 1);
        }}
      />
    );
  return (
    <section>
      <h2>자체 수기 일반 작업계획</h2>
      <p>{workPlanWarning}</p>
      {error && <p role="alert">{error}</p>}
      {site.role !== "viewer" && (
        <button disabled={busy} onClick={() => setRecord(null)}>
          일반 작업계획 초안 작성
        </button>
      )}
      {loading ? (
        <p>조회 중</p>
      ) : (
        page.items.map((r) => (
          <article key={r.id}>
            <h3>{r.body.title}</h3>
            <p>
              {r.body.date} {r.body.startTime}~{r.body.endTime} ·{" "}
              {r.status === "archived" ? "고정 보관본 · 문서검토는 상세" : "초안"}
            </p>
            <button disabled={busy} onClick={() => void view(r.id)}>
              작업계획 열기
            </button>
          </article>
        ))
      )}
      <button
        disabled={busy || loading || !offset}
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
