import { useEffect, useState } from "react";
import { api, type Site, type User } from "./api";
import { NavIcon } from "./AppShell";
import { StatusChip, UiIcon, ICON } from "./ui";
// 홈 = 오늘 할 일 (UI 개편 PR 2). 기존 목록 API를 모아 보여 주기만 한다 — 서버 변경 없음, 판단·집계 없음.
type Row = { id: string; status: string; author_id?: string; owner_id?: string; date?: string; body?: { date?: string; title?: string; summary?: string } };
type Period = { id: string; month: string; status: string };
type Data = { journals: Row[]; tbm: Row[]; inspections: Row[]; plans: Row[]; periods: Period[] };
const today = () => new Date().toLocaleDateString("en-CA");
const KOR_DATE = (d: string) => { const [y, m, day] = d.split("-").map(Number); return `${m}월 ${day}일 (${"일월화수목금토"[new Date(y, m - 1, day).getDay()]})`; };
export function Home({ site, user, ads, onOpen }: { site: Site | undefined; user: User; ads?: boolean; onOpen: (tab: string) => void }) {
  const [data, setData] = useState<Data | null>(null), [error, setError] = useState("");
  useEffect(() => {
    if (!site) { setData(null); return; }
    let active = true;
    const base = `/sites/${site.id}`, list = <T,>(p: string) => api<{ items: T[] }>(base + p).then((v) => v.items).catch(() => [] as T[]);
    Promise.all([list<Row>("/daily-journals"), list<Row>("/tbm"), list<Row>("/inspections"), list<Row>("/work-plans"), site.role === "manager" ? list<Period>("/cost-periods") : Promise.resolve([] as Period[])])
      .then(([journals, tbm, inspections, plans, periods]) => { if (active) setData({ journals, tbm, inspections, plans, periods }); })
      .catch((e) => active && setError((e as Error).message));
    return () => { active = false; };
  }, [site?.id, site?.role]);
  const d = today();
  if (!site) return (
    <section className="home">
      <h1>오늘</h1>
      <p className="muted">{KOR_DATE(d)}</p>
      <div className="ui-empty"><img src="/illustrations/no-records.svg" alt="" /><strong>아직 현장이 없습니다</strong><span>현장을 만들면 오늘 할 일이 여기에 모입니다.</span><button type="button" onClick={() => onOpen("sites")}>현장 만들러 가기</button></div>
    </section>
  );
  const mine = (r: Row) => (r.author_id ?? r.owner_id) === user.id;
  const tbmToday = data?.tbm.filter((t) => t.body?.date === d) ?? [], journalToday = data?.journals.find((j) => j.date === d);
  const waiting = [
    ...(data?.inspections.filter((i) => i.status === "submitted").map((i) => ({ kind: "점검", id: i.id, tab: "inspections", when: i.body?.date ?? "", title: "점검 제출본" })) ?? []),
  ];
  const drafts = [
    ...(data?.journals.filter((j) => j.status === "draft" && mine(j)).map((j) => ({ kind: "안전업무일지", id: j.id, tab: "daily", when: j.date ?? "", title: j.body?.summary || "작성 중인 일지" })) ?? []),
    ...(data?.tbm.filter((t) => t.status === "draft" && mine(t)).map((t) => ({ kind: "TBM", id: t.id, tab: "tbm", when: t.body?.date ?? "", title: t.body?.title || "작성 중인 TBM" })) ?? []),
    ...(data?.plans.filter((p) => p.status === "draft" && mine(p)).map((p) => ({ kind: "작업계획", id: p.id, tab: "workplans", when: p.body?.date ?? "", title: p.body?.title || "작성 중인 작업계획" })) ?? []),
    ...(data?.inspections.filter((i) => i.status === "draft" && mine(i)).map((i) => ({ kind: "점검", id: i.id, tab: "inspections", when: i.body?.date ?? "", title: "작성 중인 점검" })) ?? []),
  ].sort((a, b) => b.when.localeCompare(a.when)).slice(0, 6);
  const openPeriod = data?.periods.find((p) => p.status === "open");
  const card = (tab: string, label: string, value: string, tone: "signal" | "draft" | "neutral", icon: string) => (
    <button type="button" className={`home-card tone-${tone}`} onClick={() => onOpen(tab)}>
      <span className="home-card-label"><NavIcon name={icon} size={16} />{label}</span>
      <span className="home-card-value">{value}</span>
    </button>
  );
  return (
    <section className="home">
      <div className="home-head">
        <h1>오늘</h1>
        <span className="muted">{KOR_DATE(d)} · {site.name}</span>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="home-cards">
        {card("tbm", "오늘 TBM", tbmToday.length ? `${tbmToday.length}건 기록됨` : "아직 없음 · 시작하기", tbmToday.length ? "neutral" : "signal", "tbm")}
        {card("daily", "오늘 안전업무일지", journalToday ? (journalToday.status === "draft" ? "작성 중 · 이어 쓰기" : "보관됨") : "아직 없음 · 쓰기", journalToday ? "draft" : "signal", "journal")}
        {card("inspections", "내 확인 기다림", waiting.length ? `점검 ${waiting.length}건` : "없음", waiting.length ? "signal" : "neutral", "inspection")}
        {site.role === "manager" && card("costs", "비용 원장", openPeriod ? `${openPeriod.month} 작성 중` : "열린 월 없음", openPeriod ? "draft" : "neutral", "cost")}
      </div>
      <section className="home-list">
        <h2>내가 작성 중인 기록 <span className="muted">{data ? `${drafts.length}건` : "조회 중"}</span></h2>
        {data && drafts.length === 0 && <p className="ui-empty"><img src="/illustrations/all-done.svg" alt="" /><strong>작성 중인 기록이 없습니다</strong></p>}
        {drafts.map((r) => (
          <button type="button" key={r.kind + r.id} className="home-row" onClick={() => onOpen(r.tab)}>
            <span className="home-row-kind">{r.kind}</span>
            <span className="home-row-title">{r.when ? KOR_DATE(r.when) + " · " : ""}{r.title}</span>
            <StatusChip tone="draft">작성 중</StatusChip>
          </button>
        ))}
      </section>
      {waiting.length > 0 && (
        <section className="home-list">
          <h2>내 확인을 기다리는 제출 <span className="muted">{waiting.length}건</span></h2>
          {waiting.map((r) => (
            <button type="button" key={r.kind + r.id} className="home-row" onClick={() => onOpen(r.tab)}>
              <span className="home-row-kind">{r.kind}</span>
              <span className="home-row-title">{r.when ? KOR_DATE(r.when) + " · " : ""}{r.title}</span>
              <StatusChip tone="pending">확인 대기</StatusChip>
            </button>
          ))}
        </section>
      )}
      <section className="home-list">
        <h2>바로 가기</h2>
        <div className="home-actions">
          <button type="button" onClick={() => onOpen("tbm")}><UiIcon d={ICON.check} />TBM 시작</button>
          <button type="button" className="secondary" onClick={() => onOpen("inspections")}>점검 작성</button>
          <button type="button" className="secondary" onClick={() => onOpen("hazards")}>신고 접수</button>
          <button type="button" className="secondary" onClick={() => onOpen("photoboard")}>사진 올리기</button>
        </div>
      </section>
      {ads && <aside className="ad-slot" aria-label="광고 자리">광고 · 자체 자리 표시만 활성화됨 (외부 광고/추적 없음)</aside>}
    </section>
  );
}
