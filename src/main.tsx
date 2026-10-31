import { HelpPanel } from "./HelpPanel";
import { helpDestinationAllowed } from "./help-topics";
import {
  RiskActionsPanel,
  RiskCorePanel,
  CompanyPpePanel,
  WorkStopPanel,
  ManagerOverview,
  WorkPlanPanel,
  StockPanel,
  CostPanel,
  DailyJournalPanel,
  EquipmentPanel,
  NoticesPanel,
  EducationPanel,
  InspectionsPanel,
  HazardsPanel,
  TbmPanel,
  WorkersAttendance,
  PhotoBoardPanel,
  LibraryPanel,
} from "./DomainPanels";
import { Login } from "./Login";
import { JoinPage } from "./JoinPage";
import { Minutes } from "./Minutes";
import { SiteManagement } from "./SiteManagement";
import { PasswordChange } from "./PasswordChange";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, setCsrf, type Meeting, type Site, type User } from "./api";
import { MeetingEditor } from "./MeetingEditor";
import "./style.css";
function App() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [sites, setSites] = useState<Site[]>([]),
    [siteId, setSiteId] = useState(""),
    [tab, setTab] = useState("home"),
    [mobileMenuOpen, setMobileMenuOpen] = useState(false),
    [ads, setAds] = useState(false),
    [editor, setEditor] = useState<{ initial: Meeting | null } | null>(null);
  const [attendanceDirty, setAttendanceDirty] = useState(false);
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  function mayLeaveAttendance() {
    return (
      !attendanceBusy &&
      (!attendanceDirty ||
        window.confirm("저장하지 않은 업무 입력을 버리고 이동할까요?"))
    );
  }
  const site = sites.find((s) => s.id === siteId);
  async function refreshSites() {
    const list = await api<Site[]>("/sites");
    setSites(list);
    setSiteId((id) => (list.some((s) => s.id === id) ? id : list[0]?.id || ""));
  }
  useEffect(() => {
    api<{ user: User | null; csrf: string; adsEnabled: boolean }>("/session")
      .then((s) => {
        setUser(s.user);
        setCsrf(s.csrf);
        setAds(s.adsEnabled);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (user) refreshSites().catch((e) => setError(e.message));
  }, [user]);
  async function logout() {
    if (!mayLeaveAttendance()) return;
    if (
      editor &&
      !window.confirm(
        "회의록 입력을 닫고 로그아웃할까요? 저장하지 않은 내용은 사라집니다.",
      )
    )
      return;
    try {
      await api("/logout", "POST");
      setEditor(null);
      setSites([]);
      setUser(null);
      const s = await api<{ csrf: string }>("/session");
      setCsrf(s.csrf);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (loading)
    return (
      <main className="login">
        <h1>Y웹</h1>
        <p>연결 중…</p>
      </main>
    );
  if (!user)
    return (
      <Login
        onLogin={(u) => {
          setUser(u);
          setError("");
        }}
        error={error}
      />
    );
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#">
          Y웹<span>현장 업무의 한곳</span>
        </a>
        <span className="badge">개발용 · 독립 검증 미완료</span>
        <label className="site-switch">
          작업 현장
          <select
            disabled={!!editor || attendanceBusy}
            value={siteId}
            onChange={(e) => {
              if (!mayLeaveAttendance()) return;
              setSiteId(e.target.value);
              setError("");
            }}
          >
            <option value="" disabled>
              현장을 만들어 주세요
            </option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="mobile-menu-toggle secondary"
          aria-expanded={mobileMenuOpen}
          aria-controls="primary-navigation"
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          {mobileMenuOpen ? "업무 메뉴 닫기" : "업무 메뉴 열기"}
        </button>
        <nav
          id="primary-navigation"
          aria-label="주 메뉴"
          className={mobileMenuOpen ? "mobile-menu-open" : ""}
        >
          {[
            ["home", "현장 홈"],
            ["help", "사용 도움말"],
            ...(sites.some((s) => s.role === "manager")
              ? [["overview", "관리 현장 현황"]]
              : []),
            ["account", "내 비밀번호 변경"],
            ["minutes", "회의록"],
            ["attendance", "명부 · 출역"],
            ["companyppe", "업체 · 소속 · 보호구"],
            ["riskcore", "위험성평가 문서"],
            ["riskactions", "위험성평가 조치 추적"],
            ["tbm", "TBM 기록"],
            ["hazards", "신고 · 조치"],
            ["workstops", "중지 요청 · 수기 기록"],
            ["inspections", "자체 양식 · 점검"],
            ["daily", "안전업무일지"],
            ["photoboard", "사진 보드"],
            ["library", "현장 자료실"],
            ...(site?.role === "manager"
              ? [
                  ["costs", "수기 비용 원장"],
                  ["stock", "수기 재고 수불"],
                ]
              : []),
            ["education", "수기 교육일지"],
            ["notices", "현장 계정 공지"],
            ["equipment", "장비 · 수기 사용"],
            ["workplans", "수기 일반 작업계획"],
            ["sites", "현장 관리"],
          ].map(([id, title]) => (
            <button
              disabled={!!editor || attendanceBusy}
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => {
                if (id !== tab && !mayLeaveAttendance()) return;
                setTab(id);
                setError("");
                setMobileMenuOpen(false);
              }}
            >
              {title}
              <span>↗</span>
            </button>
          ))}
          <p className="nav-label">통합 예정 · 현재 사용할 수 없음</p>
          {[
            "비용 법정 기준·분할·원본 가져오기",
            "원본 C 서식 동등성",
            "원본 P 작업계획·계산",
            "원본 교육내용 카탈로그",
            "D 사진·원본 보고서·오프라인",
            "전자서명",
          ].map((v) => (
            <div className="planned" key={v}>
              {v}
              <small>예정</small>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <strong>{user.name}</strong>
          <small>{user.email}</small>
          <button className="secondary" onClick={logout}>
            로그아웃
          </button>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <span>{site?.name || "시작하기"}</span>
          <span>
            {site
              ? { manager: "현장 관리자", editor: "작성자", viewer: "열람자" }[
                  site.role
                ]
              : "현장 미선택"}
          </span>
        </header>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {editor && site ? (
          <MeetingEditor
            user={user}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
            key={site.id + (editor.initial?.id || "new")}
            site={site}
            initial={editor.initial}
            onClose={() => setEditor(null)}
            onSaved={() => {}}
          />
        ) : tab === "overview" ? (
          <ManagerOverview
            sites={sites}
            onOpen={(id, next) => {
              setSiteId(id);
              setTab(next);
            }}
          />
        ) : tab === "help" ? (
          <HelpPanel
            site={site}
            disabled={!!editor || attendanceBusy}
            onNavigate={(next) => {
              if (!helpDestinationAllowed(next, site?.role)) return;
              if (editor || !mayLeaveAttendance()) return;
              setTab(next);
              setError("");
            }}
          />
        ) : tab === "home" ? (
          <>
            <div className="page-heading">
              <p className="eyebrow">YOUR SITE, CLEARLY ORGANIZED</p>
              <h1>
                오늘의 기록을,
                <br />
                한곳에서 이어가세요.
              </h1>
              <p>
                현재는 현장·권한 관리, 회의록·수기 출역·TBM 기록이 연결되어
                있습니다.
                <br />
                추가 구현 범위와 미지원 항목은 업무별 안내를 확인하세요. 운영
                서비스 전환은 별도입니다.
              </p>
            </div>
            <div className="cards">
              <article className="panel feature">
                <span className="module-code">MT</span>
                <h2>회의록</h2>
                <p>
                  안건부터 결정 사항, 담당자와 후속 조치까지.
                  <br />
                  저장된 회의록을 인쇄하고 PDF로 보관하세요.
                </p>
                <button disabled={!site} onClick={() => setTab("minutes")}>
                  회의록 열기 →
                </button>
              </article>
              <article className="panel">
                <span className="module-code">SITE</span>
                <h2>현장별로 안전하게</h2>
                <p>
                  현장 관리자·작성자·열람자 권한을 분리합니다. 다른 현장 자료는
                  배정받은 계정만 접근합니다.
                </p>
                <button className="secondary" onClick={() => setTab("sites")}>
                  현장 관리 →
                </button>
              </article>
            </div>
            <div className="notice">
              개발 기반 · 운영 전환 아님. 기존 N/SC 개발은 유지합니다. 법정 서식
              적합성과 법적 효력을 보장하지 않습니다.
            </div>
            {ads && (
              <aside className="ad-slot" aria-label="광고 자리">
                광고 · 자체 자리 표시만 활성화됨 (외부 광고/추적 없음)
              </aside>
            )}
          </>
        ) : tab === "account" ? (
          <PasswordChange
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
            onClose={() => setTab("home")}
            onChanged={() => {
              setEditor(null);
              setSites([]);
              setSiteId("");
              setUser(null);
              setTab("home");
              setCsrf("");
              setError(
                "비밀번호를 변경했습니다. 새 비밀번호로 다시 로그인하세요.",
              );
              void api<{ csrf: string }>("/session")
                .then((s) => setCsrf(s.csrf))
                .catch(() =>
                  setError(
                    "비밀번호를 변경했습니다. 새로고침한 뒤 로그인하세요.",
                  ),
                );
            }}
          />
        ) : tab === "sites" ? (
          <SiteManagement sites={sites} site={site} refresh={refreshSites} />
        ) : site && tab === "stock" && site.role === "manager" ? (
          <StockPanel
            key={site.id}
            site={site}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "costs" && site.role === "manager" ? (
          <CostPanel
            key={site.id}
            site={site}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "library" ? (
          <LibraryPanel key={site.id} site={site} />
        ) : site && tab === "photoboard" ? (
          <PhotoBoardPanel
            key={site.id}
            site={site}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "daily" ? (
          <DailyJournalPanel
            key={site.id}
            site={site}
            user={user}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "workplans" ? (
          <WorkPlanPanel
            key={site.id}
            site={site}
            user={user}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "equipment" ? (
          <EquipmentPanel
            key={site.id}
            site={site}
            user={user}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "notices" ? (
          <NoticesPanel
            key={site.id}
            site={site}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "education" ? (
          <EducationPanel
            key={site.id}
            site={site}
            user={user}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "inspections" ? (
          <InspectionsPanel
            key={site.id}
            site={site}
            user={user}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "riskactions" ? (
          <RiskActionsPanel
            key={site.id}
            site={site}
            user={user}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "riskcore" ? (
          <RiskCorePanel
            key={site.id}
            site={site}
            user={user}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "companyppe" ? (
          <CompanyPpePanel
            key={site.id}
            site={site}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "workstops" ? (
          <WorkStopPanel
            key={site.id}
            site={site}
            user={user}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "hazards" ? (
          <HazardsPanel
            key={site.id}
            site={site}
            user={user}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "tbm" ? (
          <TbmPanel
            key={site.id}
            site={site}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site && tab === "attendance" ? (
          <WorkersAttendance
            key={site.id}
            site={site}
            onDirtyChange={setAttendanceDirty}
            onBusyChange={setAttendanceBusy}
          />
        ) : site ? (
          <Minutes site={site} open={(initial) => setEditor({ initial })} />
        ) : (
          <div className="panel">
            <h1>현장을 먼저 만들어 주세요.</h1>
            <button onClick={() => setTab("sites")}>현장 관리</button>
          </div>
        )}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {location.pathname === "/join" ? <JoinPage /> : <App />}
  </React.StrictMode>,
);
