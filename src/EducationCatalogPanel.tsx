import { EducationContentTransfer } from "./EducationContentTransfer";
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
    <section>
      <button disabled={busy} onClick={onClose}>
        교육일지 목록으로
      </button>
      <h2>자체 교육내용 카탈로그</h2>
      <p>{catalogWarning}</p>
      {site.role==="manager"&&<button disabled={busy} onClick={()=>setTransfer(true)}>자체 내용 JSON 가져오기 / 내보내기</button>}
      {site.role === "manager" && (
        <button disabled={busy} onClick={() => setRecord(null)}>
          자체 내용 초안 작성
        </button>
      )}
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
      <label>접근 가능한 개정 계열<select value={lineage} disabled={busy} onChange={e=>{setLineage(e.target.value);setOffset(0);}}><option value="all">전체 이력</option><option value="visible_leaf">보이는 후속본 없음</option><option value="has_visible_successor">보이는 후속본 있음</option></select></label>
      <label>게시본 신규사용<select value={useFilter} disabled={busy} onChange={e=>{setUseFilter(e.target.value);setOffset(0);}}><option value="all">전체</option><option value="available">중지 기록 없는 게시본</option><option value="stopped">신규사용 중지 게시본</option></select></label>
      <p>현재 조건 {loading?"조회 중":page.total}개 · 50개씩 · 페이지 이동 사이에 자료가 바뀔 수 있습니다. 최신본/법정적합을 자동 선택하지 않습니다.</p>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p>조회 중</p>
      ) : (
        page.items.map((r) => (
          <article key={r.id}>
            <h3>{r.title}</h3>
            <p>
              {r.status === "published" ? "고정 게시본" : "관리자 초안"} · ID{" "}
              {r.id} v{r.version} · {r.categoryLabel}
            </p>
            <p>{r.preview}</p><p>{r.sourceHash||"미게시 초안"} · {r.current.useStopped?"신규사용 중지":"중지 기록 없음"}{r.current.publishedSuccessor?" · 후속 게시본 있음":""}</p>
            <button disabled={busy} onClick={() => void view(r.id)}>
              교육내용 열기
            </button>
          </article>
        ))
      )}
      {!loading && !page.items.length && (
        <p>내용이 없습니다. 권리 있는 자체 자료를 직접 작성하세요.</p>
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
