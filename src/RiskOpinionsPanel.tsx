import { useEffect, useState } from "react";
import { api, type Site, type User } from "./api";
import type { RiskOpinion } from "../server/risk-opinions";
import type { RiskAssessmentRecord } from "../server/risk-core";
import { RiskOpinionCreate } from "./RiskOpinionCreate";
import { RiskOpinionEditor } from "./RiskOpinionEditor";
export function RiskOpinionsPanel({
  site,
  user,
  source,
  onClose,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  user: User;
  source?: RiskAssessmentRecord;
  onClose: () => void;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [opened, setOpened] = useState<RiskOpinion | "new" | null>(null),
    [page, setPage] = useState<{ items: RiskOpinion[]; hasMore: boolean }>({
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
    setPage({ items: [], hasMore: false });
    setError("");
    api<typeof page>(
      `/sites/${site.id}/risk-opinions?offset=${offset}${source ? "&assessmentId=" + source.id : ""}`,
    )
      .then((p) => {
        if (active) setPage(p);
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
  }, [site.id, source?.id, offset, opened, tick]);
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
  if (opened === "new" && source)
    return (
      <RiskOpinionCreate {...common} initial={source} onSaved={setOpened} />
    );
  if (opened && opened !== "new")
    return <RiskOpinionEditor {...common} initial={opened} user={user} />;
  return (
    <section>
      <button disabled={loading} onClick={onClose}>
        문서 화면으로
      </button>
      <h2>
        {site.role === "manager" ? "현장 관리자 의견함" : "내 계정 의견함"}
      </h2>
      <p>
        다른 일반 계정의 의견은 보여 주지 않습니다. 실제 근로자/협력업체 참여
        증명이나 서명이 아닙니다. 새 의견은 특정 제출/수락 문서에서 시작하세요.
      </p>
      {error && <p role="alert">{error}</p>}
      <button disabled={loading} onClick={() => setTick((x) => x + 1)}>
        다시 조회
      </button>
      {source &&
        site.role !== "viewer" &&
        ["submitted", "accepted"].includes(source.status) &&
        !source.successor_id && (
          <button disabled={loading} onClick={() => setOpened("new")}>
            이 고정 문서에 내 계정 의견
          </button>
        )}
      <ul>
        {page.items.map((r) => (
          <li key={r.id}>
            <button disabled={loading} onClick={() => setOpened(r)}>
              {r.source.title} / {r.original.author.name} /{" "}
              {r.status === "open" ? "응답 대기" : "응답 기록"} / v{r.version}
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
        이전 50
      </button>
      <button
        disabled={loading || !page.hasMore}
        onClick={() => {
          setLoading(true);
          setOffset((x) => x + 50);
        }}
      >
        다음 50
      </button>
    </section>
  );
}
