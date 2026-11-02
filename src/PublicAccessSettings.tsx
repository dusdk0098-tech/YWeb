import { useEffect, useState } from "react";
import { api } from "./api";
import { PublicSetupWizard } from "./PublicSetupWizard";
type Mode = "off" | "direct" | "tunnel";
type Status = {
  canManage: boolean; operator?: boolean; restartNeeded: boolean; dns: string[] | null;
  runtime: { mode: Mode; origin?: string; state: string; detail?: string; certNotAfter?: string };
  settings: { mode: Mode; domain: string; email: string; tosAgreed: boolean; tunnelHint: string | null } | null;
};
const MODE: Record<Mode, string> = { off: "끄기 (이 PC에서만 사용)", direct: "직접 연결 + 자동 HTTPS (Let's Encrypt)", tunnel: "Cloudflare Tunnel" };
// Self-hosting: this PC serves the app under the owner's domain. Editable only from this PC; applied at the next app start.
export function PublicAccessSettings() {
  const [s, setS] = useState<Status | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>("off"), [domain, setDomain] = useState(""), [email, setEmail] = useState(""), [agree, setAgree] = useState(false), [token, setToken] = useState("");
  const load = () => api<Status>("/public-access").then((v) => {
    setS(v);
    if (v.settings) { setMode(v.settings.mode); setDomain(v.settings.domain); setEmail(v.settings.email); setAgree(v.settings.tosAgreed); }
  }).catch((e) => setError((e as Error).message));
  useEffect(() => { void load(); }, []);
  async function save() {
    setBusy(true); setError(""); setNotice("");
    try {
      await api("/public-access", "PUT", { mode, domain: domain.trim(), email: email.trim(), agreeTos: agree, tunnelToken: token.trim() });
      setToken(""); setNotice("저장했습니다. 앱을 다시 시작하면 적용됩니다."); await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (!s) return <section className="panel"><h2>외부 접속 설정</h2>{error ? <p className="error" role="alert">{error}</p> : <p>불러오는 중…</p>}</section>;
  const r = s.runtime;
  return (
    <section className="panel">
      <h2>외부 접속 설정</h2>
      <p>이 PC를 서버로 써서 휴대폰·다른 PC에서 구매한 도메인(예: https://safety.example.com)으로 접속하게 합니다. 이 PC가 켜져 있고 앱이 실행 중일 때만 접속됩니다. 아래 마법사를 따라가면 됩니다. 자세한 순서는 docs/SELF_HOSTING.md를 보세요.</p>
      <p role="status">지금: <strong>{r.mode === "off" ? "꺼짐 (이 PC에서만 접속)" : `${MODE[r.mode]} · ${r.state}`}</strong>{r.origin && ` · ${r.origin}`}{r.certNotAfter && ` · 인증서 만료 ${new Date(r.certNotAfter).toLocaleDateString()} (30일 전 자동 갱신)`}{r.detail && <><br />{r.detail}</>}</p>
      {s.restartNeeded && <p className="notice">저장한 설정이 아직 적용되지 않았습니다. 앱을 다시 시작하세요.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!s.canManage ? <p>외부 접속 설정은 이 앱이 설치된 PC에서 직접 접속했을 때만 바꿀 수 있습니다.</p> : <>
        {s.operator && <PublicSetupWizard onApplied={() => void load()} />}
        <details className="advanced-tools">
        <summary>고급: 직접 입력</summary>
        <fieldset disabled={busy}>
          <legend>설정 (이 PC에서 접속했을 때만 보입니다)</legend>
          <label>방식 <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>{(Object.keys(MODE) as Mode[]).map((k) => <option key={k} value={k}>{MODE[k]}</option>)}</select></label>
          {mode !== "off" && <label>도메인 <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="safety.example.com" autoComplete="off" /></label>}
          {mode !== "off" && s.dns && s.settings?.domain && <p>현재 DNS 조회 결과({s.settings.domain}): {s.dns.length ? s.dns.join(", ") : "주소 없음 — DNS 설정 전이거나 아직 전파되지 않았습니다."}</p>}
          {mode === "direct" && <>
            <label>인증서 알림 이메일 <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></label>
            <label><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> Let's Encrypt 이용약관(letsencrypt.org/repository)에 동의합니다.</label>
            <ol>
              <li>도메인 회사 DNS 설정에서 A 레코드를 이 집·사무실의 공인 IP로 지정합니다.</li>
              <li>공유기에서 외부 80·443 포트를 이 PC로 포트포워딩합니다.</li>
              <li>Windows 방화벽에서 80·443 포트 수신을 허용합니다(문서의 명령 참고 — 앱이 대신 바꾸지 않습니다).</li>
              <li>저장 후 앱을 다시 시작하면 인증서를 자동으로 받습니다.</li>
            </ol>
          </>}
          {mode === "tunnel" && <>
            <label>터널 토큰 <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" placeholder={s.settings?.tunnelHint ? `저장됨 (${s.settings.tunnelHint}) — 바꿀 때만 입력` : "eyJ…"} /></label>
            <ol>
              <li>도메인을 Cloudflare(무료 계정)에 연결합니다.</li>
              <li>Cloudflare Zero Trust → Networks → Tunnels에서 터널을 만들고 토큰을 복사합니다.</li>
              <li>터널의 Public Hostname을 이 도메인, 서비스는 http://127.0.0.1:3000으로 지정합니다(DNS는 Cloudflare가 자동 등록).</li>
              <li>이 PC에 cloudflared를 설치합니다: winget install --id Cloudflare.cloudflared</li>
              <li>저장 후 앱을 다시 시작합니다.</li>
            </ol>
          </>}
          <button type="button" onClick={() => void save()}>저장</button>
          <small> 외부에 열면 비밀번호가 약한 계정이 위험해집니다. 모든 계정이 12자 이상의 강한 비밀번호를 쓰게 하세요.</small>
        </fieldset>
        </details>
      </>}
    </section>
  );
}
