import { useEffect, useState } from "react";
import { api } from "./api";
import { resetAiStatus } from "./AiDescriptionSuggest";
type KeyInfo = { hint: string; monthlyLimit: number; used: number } | null;
type Status = { enabled: boolean; model?: string; remaining?: number; source: "env" | "app"; mode: "off" | "install" | "account"; models: string[]; canManageInstall: boolean; installKey: KeyInfo; myKey: KeyInfo };
const MODE = { off: "끄기", install: "이 PC 공용 키 하나", account: "계정마다 본인 키" } as const;
// SC-04: AI wording suggestion settings. The install-wide part shows only on the server PC itself; keys are never shown back.
export function AiSettings() {
  const [s, setS] = useState<Status | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Status["mode"]>("off"), [model, setModel] = useState("");
  const load = () => api<Status>("/ai/status").then((v) => { setS(v); setMode(v.mode); setModel(v.model || v.models[0]); resetAiStatus(); }).catch((e) => setError((e as Error).message));
  useEffect(() => { void load(); }, []);
  async function run(f: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await f(); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (!s) return <section className="panel"><h2>AI 문구 설정</h2>{error ? <p className="error" role="alert">{error}</p> : <p>불러오는 중…</p>}</section>;
  return (
    <section className="panel">
      <h2>AI 문구 설정</h2>
      <p>비용 지출 "내용" 칸 옆의 [AI 문구 제안]에 쓰는 설정입니다. 켜면 내용 문구만(긴 숫자는 # 처리) 외부 AI(Anthropic Claude)로 보내며, 요금은 등록한 API 키 소유자에게 청구됩니다. 꺼 두어도 모든 기능을 쓸 수 있습니다.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <p role="status">현재: <strong>{s.enabled ? `켜짐 · ${s.model} · 이번 달 남은 요청 ${s.remaining}회` : "꺼짐"}</strong>{s.source === "env" ? " (.env 파일로 관리 중 — 앱에서 바꿀 수 없음)" : ` · 방식: ${MODE[s.mode]}`}</p>
      {s.source === "app" && (s.canManageInstall ? (
        <fieldset disabled={busy}>
          <legend>이 PC 공용 설정 (이 PC에서 접속했을 때만 보입니다)</legend>
          <label>사용 방식 <select value={mode} onChange={(e) => setMode(e.target.value as Status["mode"])}>{Object.entries(MODE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>모델 <select value={model} onChange={(e) => setModel(e.target.value)}>{s.models.map((m) => <option key={m}>{m}</option>)}</select></label>
          <button type="button" onClick={() => void run(() => api("/ai/settings", "PUT", { mode, model }))}>방식 저장</button>
          {mode === "install" && <KeyForm title="PC 공용 API 키" info={s.installKey} path="/ai/install-key" run={run} />}
        </fieldset>
      ) : <p>사용 방식과 PC 공용 키는 이 앱이 설치된 PC에서 직접 접속했을 때만 바꿀 수 있습니다.</p>)}
      {s.source === "app" && s.mode === "account" && <fieldset disabled={busy}><legend>내 API 키</legend><KeyForm title="내 API 키" info={s.myKey} path="/ai/my-key" run={run} /></fieldset>}
    </section>
  );
}
function KeyForm({ title, info, path, run }: { title: string; info: KeyInfo; path: string; run: (f: () => Promise<unknown>) => Promise<void> }) {
  const [apiKey, setKey] = useState(""), [limit, setLimit] = useState(info?.monthlyLimit ?? 100);
  return (
    <div>
      <p>{info ? `${title} 등록됨 (${info.hint}) · 월 상한 ${info.monthlyLimit}회 · 이번 달 ${info.used}회 사용` : `${title} 없음`}</p>
      <label>{title} <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" /></label>
      <label>월 요청 상한(회) <input type="number" min={1} max={100000} value={limit} onChange={(e) => setLimit(Number(e.target.value))} /></label>
      <button type="button" disabled={!apiKey.trim()} onClick={() => void run(async () => { await api(path, "PUT", { apiKey: apiKey.trim(), monthlyLimit: limit }); setKey(""); })}>{info ? "키 바꾸기" : "키 등록"}</button>
      {info && <button type="button" className="secondary" onClick={() => window.confirm(`${title}를 삭제할까요?`) && void run(() => api(path, "DELETE"))}>키 삭제</button>}
      <small> 키는 암호화해 이 PC에 저장하며 다시 화면에 보여 주지 않습니다. 키는 console.anthropic.com에서 만듭니다.</small>
    </div>
  );
}
