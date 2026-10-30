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
        <span className="brand">Y웹</span>
        <p className="eyebrow">A CLEARER WAY TO WORK</p>
        <h1>
          현장의 기록,
          <br />
          함께 이어가다.
        </h1>
        <p>
          현장별 업무 공간의 작은 시작.
          <br />
          통합 기반과 회의록을 먼저 만나보세요.
        </p>
        <span className="badge">격리 개발용 · 운영 서비스 아님</span>
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
          공개 가입·비밀번호 재설정·SSO는 아직 제공하지 않습니다.
        </p>
      </section>
    </main>
  );
}
