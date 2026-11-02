import { useEffect, useState } from "react";
import { api } from "./api";
import { ActionBar, Notice, StatusBar } from "./ui";
import { SetupStep, type Step } from "./SetupStep";
// 외부 접속 마법사 (specs/001-easy-domain-setup): two questions pick the method, then each step shows its state and
// the values to copy; the app does what it can (router, Cloudflare) with one button. Server: server/public-setup.ts.
type Mode = "direct" | "tunnel";
type View = {
  started: boolean; answers: { hasDomain: boolean; canRouter: boolean } | null; recommended: Mode | null; chosen: Mode | null;
  domain: string; email: string; agreeTos: boolean; cfHint: string | null; steps: Step[]; canApply: boolean; launcher: boolean; externalServices: string;
  runtime: { selfCheck?: { ok: boolean | null; detail: string } };
};
const MODE: Record<Mode, string> = { direct: "직접 연결 + 자동 HTTPS", tunnel: "Cloudflare Tunnel" };
// Matches the server's 409 text for an existing DNS record (server/public-setup.ts).
const isConflict = (m: string) => m.startsWith("이 이름에 이미 다른 DNS 레코드");
export function PublicSetupWizard({ onApplied }: { onApplied: () => void }) {
  const [v, setV] = useState<View | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false), [conflict, setConflict] = useState<string | null>(null);
  const [form, setForm] = useState({ domain: "", email: "", agreeTos: false, token: "" });
  const show = (x: View) => { setV(x); setForm((f) => ({ ...f, domain: x.domain, email: x.email, agreeTos: x.agreeTos })); };
  useEffect(() => { api<View>("/public-setup").then(show).catch((e) => setError((e as Error).message)); }, []);
  // The outside test runs in the background; look again while a step says "확인 중".
  useEffect(() => {
    if (!v?.steps.some((s) => s.check?.status === "running")) return;
    const t = setTimeout(() => void api<View>("/public-setup").then(show).catch(() => undefined), 3000);
    return () => clearTimeout(t);
  }, [v]);
  async function call(path: string, method: string, body?: unknown, done = "") {
    setBusy(true); setError(""); setNotice("");
    try { show(await api<View>("/public-setup" + path, method, body)); if (done) setNotice(done); return true; }
    catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  }
  async function run(step: string, overwrite = false) {
    setBusy(true); setError(""); setNotice(""); setConflict(null);
    try { show(await api<View>("/public-setup/run", "POST", { step, ...(overwrite ? { overwrite } : {}) })); }
    catch (e) { const m = (e as Error).message; if (isConflict(m)) setConflict(step); setError(m); } finally { setBusy(false); }
  }
  async function apply() {
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await api<{ restarting: boolean; message?: string }>("/public-setup/apply", "POST", {});
      if (!r.restarting) { setNotice(r.message ?? ""); onApplied(); return; }
      setNotice("앱을 다시 시작하는 중입니다. 잠시 뒤 이 화면이 새로 열립니다.");
      const wait = () => setTimeout(() => void fetch("/api/session").then((x) => (x.ok ? location.reload() : wait())).catch(wait), 2000);
      wait();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (!v) return error ? <p role="alert" className="error">{error}</p> : null;
  const messages = <>{error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}</>;
  if (!v.answers) return (
    <section className="ui-section">
      <div className="ui-section-head"><h2>도메인 연결</h2></div>
      <div className="ui-section-body">
        <p>휴대폰·다른 PC에서 산 도메인으로 이 앱에 접속하게 합니다. 단계마다 앱이 확인하고, 할 수 있는 일은 대신 합니다.</p>
        {messages}
        {!open ? <button type="button" onClick={() => setOpen(true)}>도메인 연결 시작</button> : (
          <form onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); void call("/answers", "PUT", { hasDomain: d.get("hasDomain") === "yes", canRouter: d.get("canRouter") === "yes" }); }}>
            <fieldset disabled={busy}>
              <legend>도메인이 있나요?</legend>
              <label><input type="radio" name="hasDomain" value="yes" required /> 도메인이 있어요</label>
              <label><input type="radio" name="hasDomain" value="no" /> 아직 없어요</label>
            </fieldset>
            <fieldset disabled={busy}>
              <legend>공유기 설정을 바꿀 수 있나요?</legend>
              <label><input type="radio" name="canRouter" value="yes" required /> 공유기 설정을 바꿀 수 있어요</label>
              <label><input type="radio" name="canRouter" value="no" /> 어려워요(회사·건물 공유기)</label>
            </fieldset>
            <button disabled={busy}>다음</button>
          </form>
        )}
      </div>
    </section>
  );
  const reset = () => { if (window.confirm("마법사를 처음부터 다시 할까요? 이미 적용한 외부 접속 설정은 그대로 둡니다.")) void call("", "DELETE").then(() => setOpen(false)); };
  if (!v.answers.hasDomain) return (
    <section className="ui-section">
      <div className="ui-section-head"><h2>도메인 연결</h2></div>
      <div className="ui-section-body">
        <Notice summary="먼저 도메인이 필요합니다.">도메인 등록 대행사에서 원하는 주소를 사세요(보통 1년 단위). DNS 레코드를 직접 편집할 수 있는 곳이어야 합니다. 산 뒤 처음부터 다시 시작하세요.</Notice>
        {messages}
        <button type="button" className="secondary" disabled={busy} onClick={reset}>처음부터</button>
      </div>
    </section>
  );
  const mode = v.chosen!;
  const saveForm = (patch: object, done: string) => void call("/form", "PUT", patch, done);
  return (
    <div className="setup-wizard">
      <section className="ui-section">
        <div className="ui-section-head"><h2>도메인 연결</h2></div>
        <div className="ui-section-body">
          <p>추천 방식: <strong>{MODE[v.recommended!]}</strong>{v.recommended === "direct" ? " (공유기 설정을 바꿀 수 있음)" : " (공유기를 만지지 않아도 됨)"}</p>
          <label>방식 <select value={mode} disabled={busy} onChange={(e) => saveForm({ chosen: e.target.value }, "")}>{(Object.keys(MODE) as Mode[]).map((k) => <option key={k} value={k}>{MODE[k]}</option>)}</select></label>
          {mode === "tunnel" && <Notice summary="접속 내용이 Cloudflare를 거칩니다. 데이터는 이 PC에만 저장됩니다." />}
          {messages}
          {conflict && <button type="button" className="danger" disabled={busy} onClick={() => void run(conflict, true)}>덮어쓰기</button>}
          <button type="button" className="secondary" disabled={busy} onClick={() => void call("/check", "POST", { step: "all" })}>모두 다시 확인</button>
        </div>
      </section>
      {v.steps.map((s, i) => (
        <SetupStep key={s.id} step={s} no={i + 1} busy={busy} onCheck={(id) => void call("/check", "POST", { step: id })} onRun={(id) => void run(id)}>
          {s.id === "domain" && (
            <form className="inline-create" onSubmit={(e) => { e.preventDefault(); saveForm({ domain: form.domain.trim().toLowerCase() }, "도메인을 저장했습니다."); }}>
              <label>도메인<input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="safety.example.com" autoComplete="off" required /></label>
              <button disabled={busy}>도메인 저장</button>
            </form>
          )}
          {s.id === "cert-info" && (
            <form className="inline-create" onSubmit={(e) => { e.preventDefault(); saveForm({ email: form.email.trim(), agreeTos: form.agreeTos }, "인증서 정보를 저장했습니다."); }}>
              <label>인증서 알림 이메일<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="off" required /></label>
              <label><input type="checkbox" checked={form.agreeTos} onChange={(e) => setForm({ ...form, agreeTos: e.target.checked })} /> Let's Encrypt 이용약관(letsencrypt.org/repository)에 동의합니다.</label>
              <button disabled={busy}>인증서 정보 저장</button>
            </form>
          )}
          {s.id === "cf-token" && (
            <form className="inline-create" onSubmit={(e) => { e.preventDefault(); void call("/cf-token", "PUT", { token: form.token.trim() }, "토큰을 확인하고 저장했습니다.").then((ok) => ok && setForm({ ...form, token: "" })); }}>
              <label>API 토큰<input type="password" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} autoComplete="off" placeholder={v.cfHint ? `저장됨 (${v.cfHint}) — 바꿀 때만 입력` : "토큰 붙여 넣기"} /></label>
              <button disabled={busy || !form.token.trim()}>토큰 확인</button>
              {v.cfHint && <button type="button" className="secondary" disabled={busy} onClick={() => void call("/cf-token", "DELETE", undefined, "토큰을 지웠습니다.")}>토큰 지우기</button>}
            </form>
          )}
        </SetupStep>
      ))}
      {v.runtime.selfCheck && <StatusBar tone={v.runtime.selfCheck.ok ? "success" : v.runtime.selfCheck.ok === null ? "warning" : "error"}>적용 확인: {v.runtime.selfCheck.detail}</StatusBar>}
      <p className="muted">{v.externalServices}</p>
      <ActionBar note={v.canApply ? "모든 단계가 끝났습니다." : "모든 단계가 '완료'가 되면 적용할 수 있습니다."}>
        <button type="button" disabled={busy || !v.canApply} onClick={() => void apply()}>{v.launcher ? "다시 시작해 적용" : "설정 적용"}</button>
        <button type="button" className="secondary" disabled={busy} onClick={reset}>처음부터</button>
      </ActionBar>
    </div>
  );
}
