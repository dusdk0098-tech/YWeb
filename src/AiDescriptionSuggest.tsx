import { useEffect, useState } from "react";
import { api } from "./api";
// SC-04 1단계: optional AI wording suggestion. Hidden when AI is off; the user decides whether to apply it.
let status: Promise<{ enabled: boolean; remaining?: number }> | null = null;
export function AiDescriptionSuggest({ siteId, text, onApply }: { siteId: string; text: string; onApply: (v: string) => void }) {
  const [enabled, setEnabled] = useState(false), [result, setResult] = useState<{ suggestion: string; sent: string } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    (status ??= api<{ enabled: boolean }>("/ai/status").catch(() => ({ enabled: false }))).then((s) => active && setEnabled(s.enabled));
    return () => { active = false; };
  }, []);
  if (!enabled) return null;
  async function ask() {
    setBusy(true); setError(""); setResult(null);
    try { setResult(await api<{ suggestion: string; sent: string }>(`/sites/${siteId}/ai/expense-description`, "POST", { text })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <span>
    <button type="button" disabled={busy || !text.trim()} onClick={() => void ask()}>AI 문구 제안</button>
    <small> 내용 문구만 외부 AI(Claude)로 보냅니다(긴 숫자는 # 처리). 이름·금액은 넣지 마세요.</small>
    {error && <small role="alert"> {error}</small>}
    {result && <span role="status"> 제안: <q>{result.suggestion}</q> (보낸 문구: {result.sent})
      <button type="button" onClick={() => { onApply(result.suggestion); setResult(null); }}>제안 적용</button>
      <button type="button" onClick={() => setResult(null)}>닫기</button></span>}
  </span>;
}
