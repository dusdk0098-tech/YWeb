import { useEffect, useState } from "react";
import { api, setCsrf } from "./api";
// MOB-01 1단계: no-login TBM participation page. The token stays in the URL fragment, so it never reaches server logs.
export function JoinPage() {
  const token = new URLSearchParams(location.hash.slice(1)).get("t") ?? "";
  const [info, setInfo] = useState<{ title: string; date: string; location: string } | null>(null), [name, setName] = useState(""), [birthDate, setBirthDate] = useState(""),
    [result, setResult] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ csrf: string }>("/session").then((s) => { setCsrf(s.csrf); return api<NonNullable<typeof info>>("/join/info", "POST", { token }); })
      .then(setInfo).catch((e) => setError(e.message));
  }, [token]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const r = await api<{ already: boolean; name: string; at: string }>("/join", "POST", { token, name, birthDate });
      setResult(`${r.name}님의 참여를 ${r.already ? "이미 " : ""}기록했습니다 (${new Date(r.at).toLocaleString()}). 담당자가 확인한 뒤 TBM 명부에 반영합니다.`);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return <main className="workspace">
    <section className="panel">
      <h1>TBM 참여 확인</h1>
      {info && <p>{info.title} · {info.date} · {info.location}</p>}
      <p>TBM 명부에 있는 이름과 생년월일을 입력하세요. 이 기록은 참여 의사 확인용이며 서명·출석 증명이 아닙니다. 생년월일은 비교에만 쓰고 저장하지 않습니다.</p>
      {error && <p role="alert">{error}</p>}
      {result ? <p role="status">{result}</p> : info && <form onSubmit={submit}>
        <label>이름<input required maxLength={100} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>생년월일<input required type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} /></label>
        <button disabled={busy || !name.trim() || !birthDate}>참여 기록</button>
      </form>}
    </section>
  </main>;
}
