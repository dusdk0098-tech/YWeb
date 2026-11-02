import type { ReactNode } from "react";
import { StatusChip, type Tone } from "./ui";
// One step of the 외부 접속 wizard: its state, the values to do it by hand, and (when the app can) a button that does it.
// An automatic attempt that fails changes only the state line; the manual values and the button stay where they were.
export type Check = { status: "ok" | "todo" | "unknown" | "running"; reason: string; current?: string; expected?: string };
export type Step = { id: string; title: string; required: boolean; help: string; check: Check | null; action: string | null; actionLabel: string | null; command: string | null; copy: { label: string; value: string }[] };
const CHIP: Record<Check["status"], [Tone, string]> = { ok: ["done", "완료"], todo: ["pending", "아직 안 됨"], unknown: ["neutral", "확인 불가"], running: ["pending", "확인 중"] };
export const CHECKABLE = new Set(["dns", "firewall", "router", "cloudflared"]);
function CopyValue({ label, value }: { label: string; value: string }) {
  return (
    <label className="copy-row">
      <span>{label}</span>
      <input readOnly value={value} onFocus={(e) => e.target.select()} />
      <button type="button" className="secondary" onClick={() => void navigator.clipboard?.writeText(value)}>복사</button>
    </label>
  );
}
export function SetupStep({ step, no, busy, onCheck, onRun, children }: { step: Step; no: number; busy: boolean; onCheck: (id: string) => void; onRun: (id: string) => void; children?: ReactNode }) {
  const c = step.check, [tone, label] = c ? CHIP[c.status] : (["neutral", "확인 전"] as [Tone, string]);
  return (
    <section className="ui-section setup-step" id={`setup-${step.id}`} aria-labelledby={`setup-${step.id}-title`}>
      <div className="ui-section-head">
        <span className="ui-section-no" aria-hidden="true">{no}</span>
        <h3 id={`setup-${step.id}-title`}>{step.title}{!step.required && <span className="muted"> · 선택</span>}</h3>
        <span className="ui-section-aside"><StatusChip tone={tone}>{label}</StatusChip></span>
      </div>
      <div className="ui-section-body">
        {c && <p role="status">{c.reason}{c.current && c.expected && c.current !== c.expected && <><br />지금: {c.current} · 필요: {c.expected}</>}</p>}
        <p className="muted">{step.help}</p>
        {children}
        {step.command && <CopyValue label="명령" value={step.command} />}
        {step.copy.map((v) => <CopyValue key={v.label} label={v.label} value={v.value} />)}
        {(CHECKABLE.has(step.id) || step.action) && (
          <div className="tool-row">
            {step.action && step.actionLabel && <button type="button" disabled={busy} onClick={() => onRun(step.id)}>{step.actionLabel}</button>}
            {CHECKABLE.has(step.id) && <button type="button" className="secondary" disabled={busy || c?.status === "running"} onClick={() => onCheck(step.id)}>다시 확인</button>}
          </div>
        )}
      </div>
    </section>
  );
}
