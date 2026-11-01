import { useEffect, useState } from "react";
import { api } from "./api";
// SC-04 1단계: optional AI wording suggestion. Hidden when AI is off; the user decides whether to apply it.
// 결정 7 (문장 다듬기): the same control, with `kind`, polishes a journal, TBM or minutes paragraph — wording only,
// no new facts and no safety judgement; the server's prompt says so and the result is applied only on request.
let status: Promise<{ enabled: boolean; remaining?: number }> | null = null;
export const resetAiStatus = () => { status = null; };
export type PolishKind = "journal_summary" | "journal_safety" | "tbm_topics" | "minutes_decisions";
export function AiDescriptionSuggest({ siteId, text, onApply, kind }: { siteId: string; text: string; onApply: (v: string) => void; kind?: PolishKind }) {
  const [enabled, setEnabled] = useState(false), [result, setResult] = useState<{ suggestion: string; sent: string } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    (status ??= api<{ enabled: boolean }>("/ai/status").catch(() => ({ enabled: false }))).then((s) => active && setEnabled(s.enabled));
    return () => { active = false; };
  }, []);
  if (!enabled) return null;
  async function ask() {
    setBusy(true); setError(""); setResult(null);
    try {
      setResult(kind
        ? await api<{ suggestion: string; sent: string }>(`/sites/${siteId}/ai/polish`, "POST", { kind, text })
        : await api<{ suggestion: string; sent: string }>(`/sites/${siteId}/ai/expense-description`, "POST", { text }));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <span className="ai-suggest">
    <button type="button" className="secondary" disabled={busy || !text.trim()} onClick={() => void ask()}>{kind ? "AI 문장 다듬기" : "AI 문구 제안"}</button>
    <small> {kind ? "쓴 글만" : "내용 문구만"} 외부 AI(Claude)로 보냅니다(긴 숫자는 # 처리). 사람 이름{kind ? "은" : "·금액은"} 넣지 마세요. 내용을 지어내거나 안전을 판단하지 않습니다.</small>
    {error && <small role="alert"> {error}</small>}
    {result && <span role="status"> 제안: <q style={{ whiteSpace: "pre-wrap" }}>{result.suggestion}</q>{kind ? "" : ` (보낸 문구: ${result.sent})`}
      <button type="button" onClick={() => { onApply(result.suggestion); setResult(null); }}>제안 적용</button>
      <button type="button" className="secondary" onClick={() => setResult(null)}>닫기</button></span>}
  </span>;
}
export const AiPolish = AiDescriptionSuggest;
