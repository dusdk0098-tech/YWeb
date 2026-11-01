import { useEffect, useState } from "react";
import { api } from "./api";
import { Notice, PageHeader, StatusChip, TechDetails } from "./ui";
// 계정 발급 (운영자 · 설치 PC 전용). The server decides every right; this screen only shows the forms.
type Account = { id: string; email: string; name: string; operator: boolean; issuer: boolean };
type AdsState = { enabled: boolean; feedUrl: string | null; fetchedAt: string | null; lastError: string | null; count: number };
export function AccountsPanel() {
  const [items, setItems] = useState<Account[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [reset, setReset] = useState<string | null>(null); // account whose password is being reset
  const [adsState, setAdsState] = useState<AdsState | null>(null);
  useEffect(() => { api<AdsState>("/ads/settings").then(setAdsState).catch(() => setAdsState(null)); }, []);
  const load = () => api<{ items: Account[] }>("/accounts").then((v) => setItems(v.items)).catch((e) => setError((e as Error).message));
  useEffect(() => { void load(); }, []);
  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); setNotice(done); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <section className="panel">
      <PageHeader level={1} title="계정 발급" />
      <Notice summary="운영자가 이 PC에서 계정을 만들고, 비밀번호를 초기화하고, 현장 관리자에게 발급 권한을 줍니다.">
        공개 가입·이메일 발송·셀프 재설정은 없습니다. 첫 비밀번호는 직접 전달하고, 받은 사람이 "내 비밀번호"에서 바꾸게 하세요.
        발급 권한을 받은 현장 관리자는 현장 관리에서 자기 현장에 들어갈 계정만 만들 수 있습니다. 모든 발급·초기화는 누가 했는지 기록됩니다.
        비밀번호 초기화는 그 계정의 로그인을 모두 끊습니다. 명령줄 발급(`npm run provision`)도 그대로 쓸 수 있습니다.
      </Notice>
      {error && <p role="alert" className="error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget, d = new FormData(f); void run(() => api("/accounts", "POST", { name: d.get("name"), email: d.get("email"), password: d.get("password"), issuer: d.get("issuer") === "on" }, crypto.randomUUID()).then(() => f.reset()), "계정을 만들었습니다. 비밀번호를 직접 전달하세요."); }}>
        <fieldset disabled={busy}>
          <legend>새 계정</legend>
          <div className="grid">
            <label>이름<input name="name" required maxLength={100} /></label>
            <label>이메일<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
            <label>첫 비밀번호 (12자 이상)<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
          </div>
          <label><input type="checkbox" name="issuer" />계정 발급 권한 (현장 관리자가 자기 현장 계정을 만들 수 있음)</label>
          <button>계정 만들기</button>
        </fieldset>
      </form>
      <h2>계정 목록 <span className="muted">{items ? `${items.length}개` : "조회 중"}</span></h2>
      {items?.map((a) => (
        <article key={a.id} className="record-row">
          <div className="record-row-main"><h2>{a.name}</h2><p>{a.email}</p></div>
          {a.operator && <StatusChip tone="done">운영자</StatusChip>}
          {a.issuer && <StatusChip tone="draft">발급 권한</StatusChip>}
          <button type="button" className="secondary" disabled={busy} onClick={() => run(() => api(`/accounts/${a.id}/grants`, "PUT", { operator: a.operator, issuer: !a.issuer }, crypto.randomUUID()), a.issuer ? "발급 권한을 회수했습니다." : "발급 권한을 주었습니다.")}>
            {a.issuer ? "발급 권한 회수" : "발급 권한 주기"}
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => setReset(reset === a.id ? null : a.id)}>비밀번호 초기화</button>
          {reset === a.id && (
            <form className="inline-create" onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); void run(() => api(`/accounts/${a.id}/password`, "POST", { password: d.get("password") }, crypto.randomUUID()).then(() => setReset(null)), `${a.name} 계정의 비밀번호를 초기화했습니다. 기존 로그인은 모두 끊겼습니다.`); }}>
              <label>새 비밀번호 (12자 이상)<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
              <button disabled={busy}>초기화</button>
            </form>
          )}
          <TechDetails><p>계정 ID {a.id}</p></TechDetails>
        </article>
      ))}
      {adsState && (
        <section className="ui-section">
          <div className="ui-section-head"><h2>광고 표시</h2></div>
          <div className="ui-section-body">
            <p className="muted">
              개발자가 운영하는 광고 피드에서 이 서버가 하루 한 번 받아 홈에 보여 줍니다. 현장·계정 정보는 보내지 않고, 클릭도 세지 않습니다(docs/ADS.md).
              {" "}{adsState.fetchedAt ? `마지막 수신 ${adsState.fetchedAt.slice(0, 16).replace("T", " ")} · 광고 ${adsState.count}개` : "아직 받은 광고가 없습니다"}{adsState.lastError ? ` · 마지막 오류: ${adsState.lastError}` : ""}
            </p>
            <label>
              <input type="checkbox" checked={adsState.enabled} disabled={busy} onChange={(e) => { const enabled = e.target.checked; void run(() => api("/ads/settings", "PUT", { enabled }).then(() => setAdsState({ ...adsState, enabled })), enabled ? "광고를 켰습니다." : "광고를 껐습니다. 끄신 만큼 개발자 후원을 부탁드립니다."); }} />
              광고 표시 (기본 켬)
            </label>
          </div>
        </section>
      )}
    </section>
  );
}
