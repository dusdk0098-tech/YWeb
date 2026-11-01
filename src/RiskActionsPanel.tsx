import { useEffect, useState } from "react";
import { Notice, PageHeader } from "./ui";
import { api, type Site, type User } from "./api";
import type { RiskAction } from "../server/risk-actions";
import { RiskActionCreate } from "./RiskActionCreate";
import { RiskActionEditor, riskActionStatus } from "./RiskActionEditor";
export function RiskActionsPanel({
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
  const [opened, setOpened] = useState<RiskAction | "new" | null>(null),
    [page, setPage] = useState<{ items: RiskAction[]; hasMore: boolean }>({
      items: [],
      hasMore: false,
    }),
    [offset, setOffset] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [tick, setTick] = useState(0);
  useEffect(() => {
    if (opened) return;
    let active = true;
    setLoading(true);
    setError("");
    setPage({ items: [], hasMore: false });
    api<typeof page>(`/sites/${site.id}/risk-actions?offset=${offset}`)
      .then((v) => {
        if (active) setPage(v);
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
  }, [site.id, offset, opened, tick]);
  useEffect(() => {
    onBusyChange(loading);
    return () => onBusyChange(false);
  }, [loading, onBusyChange]);
  const common = {
    site,
    onClose: () => setOpened(null),
    onDirtyChange,
    onBusyChange,
  };
  if (opened === "new")
    return <RiskActionCreate {...common} onSaved={setOpened} />;
  if (opened)
    return <RiskActionEditor {...common} user={user} initial={opened} />;
  return (
    <section className="panel">
      <PageHeader level={2} title="조치 추적" />
      <Notice summary="담당자 보고와 다른 관리자의 확인을 나눠 기록합니다.">
        보고와 다른 관리자의 확인 기록을 분리합니다. 실제 현장 관측/위험
        해소/작업 재개 허가가 아니며 위험행별 별도 재평가 기록은 평가 문서에서
        조회합니다.
      </Notice>
      {error && <p role="alert">{error}</p>}
      <button disabled={loading} onClick={() => setTick((x) => x + 1)}>
        목록 다시 조회
      </button>
      {site.role === "manager" && (
        <button disabled={loading} onClick={() => setOpened("new")}>
          수락 문서의 계획 선택·수기 추적 시작
        </button>
      )}
      <ul>
        {page.items.map((r) => (
          <li key={r.id}>
            <button disabled={loading} onClick={() => setOpened(r)}>
              {r.source.assessmentTitle} · {r.source.hazard.task} /{" "}
              {riskActionStatus[r.status]} / 예정 {r.due}
            </button>
          </li>
        ))}
      </ul>
      <button
        disabled={loading || !offset}
        onClick={() => {
          setLoading(true);
          setOffset((x) => x - 50);
        }}
      >
        이전50
      </button>
      <button
        disabled={loading || !page.hasMore}
        onClick={() => {
          setLoading(true);
          setOffset((x) => x + 50);
        }}
      >
        다음50
      </button>
      {loading && <p>조회 중</p>}
    </section>
  );
}
