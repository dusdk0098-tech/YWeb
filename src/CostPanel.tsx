import type { CostExpenseSelection } from "./CostSelectedExpense";
import { CostSearch } from "./CostSearch";
import { useEffect, useState } from "react";
import { api, type Site } from "./api";
import type { Page } from "./attendance-types";
import { useDraftGuard } from "./useDraftGuard";
import { CostPeriodEditor } from "./CostPeriodEditor";
import { costWarning, type CostPeriod } from "./cost-types";
// Same labels and order as the original PEDIT-SC app (src/config.js categoryNames).
const scCategoryLabels = [
  "1. 안전보건관리자 임금 등",
  "2. 안전시설비 등",
  "3. 보호구 등",
  "4. 안전보건진단비 등",
  "5. 안전보건교육비 등",
  "6. 근로자 건강장해예방비 등",
  "7. 건설재해예방전문지도기관 기술지도비",
  "8. 본사 전담조직 근로자 임금 등",
  "9. 위험성평가 등에 따른 소요비용",
];
export function CostPanel({
  site,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [page, setPage] = useState<Page<CostPeriod>>({
      items: [],
      hasMore: false,
    }),
    [offset, setOffset] = useState(0),
    [tick, setTick] = useState(0),
    [record, setRecord] = useState<CostPeriod | null>(null),
    [creating, setCreating] = useState(false),
    [month, setMonth] = useState(""),
    [note, setNote] = useState(""),
    [categories, setCategories] = useState([
      { label: "", plan: "0", opening: "0" },
    ]),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [selectedExpense,setSelectedExpense]=useState<CostExpenseSelection|undefined>(undefined);
  const [search, setSearch] = useState(false),
    [searchBusy, setSearchBusy] = useState(false);
  const guard = useDraftGuard(
    creating,
    busy || searchBusy,
    onDirtyChange,
    onBusyChange,
  );
  const base = `/sites/${site.id}/cost-periods`;
  useEffect(() => {
    let active = true;
    setLoading(true);
    api<Page<CostPeriod>>(`${base}?offset=${offset}`)
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
  }, [base, offset, tick]);
  async function open(id: string) {
    setBusy(true);
    setError("");
    try {
      setSelectedExpense(undefined);
      setRecord(await api<CostPeriod>(base + "/" + id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    setBusy(true);
    setError("");
    const body = { month, openingNote: note, categories };
    try {
      setRecord(
        await api<CostPeriod>(base, "POST", body, guard.key(base, body)),
      );
      setCreating(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (record)
    return (
      <CostPeriodEditor
        key={record.id}
        site={site}
        initial={record}
        initialExpenseSelection={selectedExpense}
        onDirtyChange={onDirtyChange}
        onBusyChange={onBusyChange}
        onOpen={(next)=>{setSelectedExpense(undefined);setRecord(next);}}
        onClose={() => {
          setRecord(null);
          setTick((v) => v + 1);
        }}
      />
    );
  if (search)
    return (
      <CostSearch
        site={site}
        onBusyChange={setSearchBusy}
        onClose={() => setSearch(false)}
        onOpen={async (row) => {
          const next = await api<CostPeriod>(base + "/" + row.periodId);
          setSelectedExpense({id:row.id,version:row.version,status:row.status});
          setRecord(next);
          setSearch(false);
        }}
      />
    );
  return (
    <section>
      <h2>관리자 수기 비용 원장</h2>
      <p>{costWarning}</p>
      <button
        disabled={busy}
        onClick={() => {
          if (guard.canLeave()) {
            setCreating(false);
            setSearch(true);
          }
        }}
      >
        전체 월 지출 검색
      </button>
      {error && <p role="alert">{error}</p>}
      {creating ? (
        <fieldset disabled={busy}>
          <legend>최초 월 원장 (현장당 한 번)</legend>
          <label>
            귀속 월
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </label>
          <label>
            초기 이월 근거
            <textarea
              value={note}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {categories.map((c, i) => (
            <div key={i}>
              <label>
                항목명
                <input
                  value={c.label}
                  maxLength={100}
                  onChange={(e) =>
                    setCategories((v) =>
                      v.map((x, j) =>
                        i === j ? { ...x, label: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              {(["plan", "opening"] as const).map((k) => (
                <label key={k}>
                  {k === "plan" ? "계획액" : "초기 누계"}
                  <input
                    inputMode="decimal"
                    value={c[k]}
                    onChange={(e) =>
                      setCategories((v) =>
                        v.map((x, j) =>
                          i === j ? { ...x, [k]: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
              ))}
              {categories.length > 1 && (
                <button
                  onClick={() =>
                    setCategories((v) => v.filter((_, j) => j !== i))
                  }
                >
                  항목 제거
                </button>
              )}
            </div>
          ))}
          <button
            onClick={() =>
              setCategories(
                scCategoryLabels.map((label) => ({ label, plan: "0", opening: "0" })),
              )
            }
          >
            기존 SC 9개 항목으로 채우기
          </button>
          <button
            disabled={categories.length >= 20}
            onClick={() =>
              setCategories((v) => [
                ...v,
                { label: "", plan: "0", opening: "0" },
              ])
            }
          >
            항목 추가
          </button>
          <p>
            항목 이름과 구성은 생성 후 고정됩니다. 이후 월은 마감본에서 다음 월
            이월로만 만듭니다.
          </p>
          <button onClick={() => void create()}>생성</button>
          <button
            onClick={() => {
              if (guard.canLeave()) setCreating(false);
            }}
          >
            취소
          </button>
        </fieldset>
      ) : (
        <>
          <button
            disabled={busy || loading || page.items.length > 0 || offset > 0}
            onClick={() => setCreating(true)}
          >
            최초 원장 만들기
          </button>
          {loading ? (
            <p>조회 중</p>
          ) : (
            page.items.map((p) => (
              <p key={p.id}>
                <button disabled={busy} onClick={() => void open(p.id)}>
                  {p.month} · {p.status === "closed" ? "마감" : "작성 중"} · v
                  {p.version}
                </button>
              </p>
            ))
          )}
          <button
            disabled={busy || loading || offset === 0}
            onClick={() => setOffset((v) => v - 50)}
          >
            이전
          </button>
          <button
            disabled={busy || loading || !page.hasMore}
            onClick={() => setOffset((v) => v + 50)}
          >
            다음
          </button>
        </>
      )}
    </section>
  );
}
