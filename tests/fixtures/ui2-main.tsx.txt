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
import { AppShell } from "./AppShell";
import { Home } from "./Home";
import { JoinPage } from "./JoinPage";
import { clearOfflineDrafts } from "./offline-draft";
import { Minutes } from "./Minutes";
import { SiteManagement } from "./SiteManagement";
import { PasswordChange } from "./PasswordChange";
import { AiSettings } from "./AiSettings";
import { PublicAccessSettings } from "./PublicAccessSettings";
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
      await clearOfflineDrafts();
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
    <AppShell
      user={user}
      sites={sites}
      siteId={siteId}
      site={site}
      tab={tab}
      disabled={!!editor || attendanceBusy}
      error={error}
      onSelectSite={(id) => {
        if (!mayLeaveAttendance()) return;
        setSiteId(id);
        setError("");
      }}
      onSelectTab={(id) => {
        if (id !== tab && !mayLeaveAttendance()) return;
        setTab(id);
        setError("");
      }}
      onLogout={logout}
    >
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
          <Home site={site} user={user} ads={ads} onOpen={(next) => { if (!mayLeaveAttendance()) return; setTab(next); setError(""); }} />
        ) : tab === "ai" ? (
          <AiSettings />
        ) : tab === "public" ? (
          <PublicAccessSettings />
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
            <h2>현장을 먼저 만들어 주세요.</h2>
            <button onClick={() => setTab("sites")}>현장 만들러 가기</button>
          </div>
        )}
    </AppShell>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {location.pathname === "/join" ? <JoinPage /> : <App />}
  </React.StrictMode>,
);
