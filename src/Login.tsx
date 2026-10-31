import { clearOfflineDrafts } from "./offline-draft";
import React, { useState } from "react";
import { api, setCsrf, type User } from "./api";
export function Login({
  onLogin,
  error: outerError,
}: {
  onLogin: (u: User) => void;
  error: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const data = new FormData(e.currentTarget);
    try {
      const s = await api<{ user: User; csrf: string }>("/login", "POST", {
        email: data.get("email"),
        password: data.get("password"),
      });
      setCsrf(s.csrf);
      await clearOfflineDrafts(); // new login → new device key, old drafts gone
      onLogin(s.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <div className="login-intro">
        <img src="/brand/yweb-mark.svg" alt="" width={48} height={48} />
        <span className="brand">Y웹</span>
        <p>현장 안전 기록</p>
        <p className="muted">TBM · 점검 · 안전업무일지 · 작업계획 · 비용 원장을 한곳에서.</p>
      </div>
      <section className="login-form panel">
        <h2>로그인</h2>
        <p>운영 담당자가 발급한 계정을 입력하세요.</p>
        <form onSubmit={submit}>
          <label>
            이메일
            <input
              type="email"
              name="email"
              required
              autoComplete="username"
              maxLength={254}
            />
          </label>
          <label>
            비밀번호
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              maxLength={128}
            />
          </label>
          {(error || outerError) && (
            <p role="alert" className="error">
              {error || outerError}
            </p>
          )}
          <button disabled={busy}>{busy ? "확인 중…" : "로그인"}</button>
        </form>
        <p className="muted">
          공개 가입·비밀번호 재설정·SSO는 제공하지 않습니다. 계정은 관리자가 만듭니다.
        </p>
      </section>
    </main>
  );
}
