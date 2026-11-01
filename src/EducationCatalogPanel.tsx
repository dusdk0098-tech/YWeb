import { EducationContentTransfer } from "./EducationContentTransfer";
import { Notice, PageHeader, StatusChip, TechDetails } from "./ui";
import { useEffect, useState } from "react";
import { api, type Site } from "./api";
import type {searchCatalog} from "../server/education-catalog-register";
type CatalogPage=ReturnType<typeof searchCatalog>;
import type { EducationFull } from "./education-types";
import { EducationCatalogEditor } from "./EducationCatalogEditor";
import { catalogWarning, type CatalogRecord } from "./education-catalog-types";
export function EducationCatalogPanel({
  site,
  onClose,
  onJournal,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  onClose: () => void;
  onJournal: (v: EducationFull) => void;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [page, setPage] = useState<CatalogPage>({
      total:0,offset:0,
      items: [],
      hasMore: false,
    }),
    [offset, setOffset] = useState(0),
    [tick, setTick] = useState(0),
    [status, setStatus] = useState(""),
    [keyword,setKeyword]=useState(""),[lineage,setLineage]=useState("all"),[useFilter,setUseFilter]=useState("all"),
    [record, setRecord] = useState<CatalogRecord | null | undefined>(undefined),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [transfer,setTransfer]=useState(false);
  const base = `/sites/${site.id}/education-catalog`;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<CatalogPage>(
      `/sites/${site.id}/education-catalog-register?offset=${offset}&keyword=${encodeURIComponent(keyword)}&lineage=${lineage}&use=${useFilter}${status ? "&status=" + status : ""}`,
    )
      .then((v) => {
        if (active) setPage(v);
      })
      .catch((e) => {
        if (active) {
          setPage({ items: [], hasMore: false,total:0,offset:0 });
          setError(e.message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [base,site.id, offset, status, keyword,lineage,useFilter,tick]);
  async function view(id: string) {
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      setRecord(await api<CatalogRecord>(base + "/" + id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  if(transfer)return <EducationContentTransfer siteId={site.id} onDirtyChange={onDirtyChange} onBusyChange={onBusyChange} onClose={()=>{setTransfer(false);setTick(t=>t+1);}} onDraft={async(id)=>{const next=await api<CatalogRecord>(base+"/"+id);setRecord(next);setTransfer(false);}}/>;
  if (record !== undefined)
    return (
      <EducationCatalogEditor
        key={record?.id || "new"}
        site={site}
        initial={record}
        onDirtyChange={onDirtyChange}
        onBusyChange={onBusyChange}
        onJournal={onJournal}
        onRevision={setRecord}
        onClose={() => {
          setRecord(undefined);
          setTick((v) => v + 1);
        }}
      />
    );
  return (
    <section className="panel">
      <PageHeader back="교육일지 목록으로" backDisabled={busy} onBack={onClose} title="자체 교육내용 카탈로그">
        {site.role === "manager" && (
          <button disabled={busy} onClick={() => setRecord(null)}>
            자체 내용 초안 작성
          </button>
        )}
      </PageHeader>
      <Notice summary="직접 쓴 교육 내용을 게시해 두고 교육일지에 골라 넣습니다.">{catalogWarning}</Notice>
      <div className="filter-bar">
      <label>
        내용 게시 상태
        <select
          disabled={busy}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">접근 가능한 전체</option>
          <option value="published">게시본</option>
          {site.role === "manager" && <option value="draft">초안</option>}
        </select>
      </label>
      <label>제목·자체 분류·본문 문자 검색<input maxLength={200} value={keyword} disabled={busy} onChange={e=>{setKeyword(e.target.value);setOffset(0);}}/></label>
      </div>
      <details className="ui-tech advanced-tools">
        <summary>관리 · JSON 가져오기/내보내기 · 개정 계열 · 신규사용 필터</summary>
        {site.role==="manager"&&<button className="secondary" disabled={busy} onClick={()=>setTransfer(true)}>자체 내용 JSON 가져오기 / 내보내기</button>}
      <label>접근 가능한 개정 계열<select value={lineage} disabled={busy} onChange={e=>{setLineage(e.target.value);setOffset(0);}}><option value="all">전체 이력</option><option value="visible_leaf">보이는 후속본 없음</option><option value="has_visible_successor">보이는 후속본 있음</option></select></label>
      <label>게시본 신규사용<select value={useFilter} disabled={busy} onChange={e=>{setUseFilter(e.target.value);setOffset(0);}}><option value="all">전체</option><option value="available">중지 기록 없는 게시본</option><option value="stopped">신규사용 중지 게시본</option></select></label>
      </details>
      <p className="muted">현재 조건 {loading?"조회 중":page.total}개 · 50개씩 · 페이지 이동 사이에 자료가 바뀔 수 있습니다. 최신본/법정적합을 자동 선택하지 않습니다.</p>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p>조회 중</p>
      ) : (
        page.items.map((r) => (
          <article key={r.id} className="record-row">
            <div className="record-row-main">
            <h3>{r.title}</h3>
            <p>{r.categoryLabel}</p>
            <p>{r.preview}</p>
            </div>
            {r.current.useStopped ? <StatusChip tone="error">신규사용 중지</StatusChip> : r.status === "published" ? <StatusChip tone="done">게시본</StatusChip> : <StatusChip tone="draft">초안</StatusChip>}
            <button className="secondary" disabled={busy} onClick={() => void view(r.id)}>
              교육내용 열기
            </button>
            <TechDetails><p>ID {r.id} v{r.version} · {r.sourceHash||"미게시 초안"}</p></TechDetails>
          </article>
        ))
      )}
      {!loading && !page.items.length && (
        <p>내용이 없습니다. 권리 있는 자체 자료를 직접 작성하세요.</p>
      )}
      <div className="actions">
      <button className="secondary" disabled={busy || loading || !offset} onClick={() => setOffset((v) => v - 50)}>
        이전 50
      </button>
      <button className="secondary" disabled={busy || loading || !page.hasMore} onClick={() => setOffset((v) => v + 50)}>
        다음 50
      </button>
      </div>
    </section>
  );
}
