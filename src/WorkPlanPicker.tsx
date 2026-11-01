import { useEffect, useState } from "react";
import { api } from "./api";
import type { Page } from "./attendance-types";
type Option = {
  id: string;
  name?: string;
  body?: { name?: string; title?: string };
  affiliation?: string;
};
export function WorkPlanPicker({
  path,
  label,
  disabled,
  onSelect,
}: {
  path: string;
  label: string;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const [page, setPage] = useState<Page<Option>>({ items: [], hasMore: false }),
    [offset, setOffset] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(""),
    [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setSelected("");
    setError("");
    api<Page<Option>>(
      `${path}${path.includes("?") ? "&" : "?"}offset=${offset}`,
    )
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
  }, [path, offset, tick]);
  return (
    <fieldset disabled={disabled || loading}>
      <legend>{label}</legend>
      {error && (
        <p role="alert">
          {error}
          <button onClick={() => setTick((v) => v + 1)}>목록 다시 조회</button>
        </p>
      )}
      <select
        aria-label={label}
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
      >
        <option value="">선택</option>
        {page.items.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name || o.body?.name || o.body?.title} {o.affiliation || ""} ·{" "}
            {o.id}
          </option>
        ))}
      </select>
      <button disabled={!selected} onClick={() => onSelect(selected)}>
        선택 적용
      </button>
      <button
        disabled={!offset}
        onClick={() => {
          setLoading(true);
          setOffset((v) => v - 50);
        }}
      >
        이전 50
      </button>
      <button
        disabled={!page.hasMore}
        onClick={() => {
          setLoading(true);
          setOffset((v) => v + 50);
        }}
      >
        다음 50
      </button>
      {loading && <p>선택 목록 조회 중</p>}
    </fieldset>
  );
}
