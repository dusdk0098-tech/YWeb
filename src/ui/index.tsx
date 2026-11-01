import type { ReactNode } from "react";
// 공통 화면 부품 (PR 1). 로직 없는 얇은 마크업 — 기존 화면이 쓰던 <p role="alert">, <details>, <fieldset>를 같은 접근성 역할로 감싼다.
// 색·간격은 src/style.css의 .ui-* 규칙과 src/styles/tokens.css가 정한다.
export type Tone = "draft" | "pending" | "done" | "error" | "neutral";
const Svg = ({ d, stroke = "currentColor", size = 16 }: { d: string; stroke?: string; size?: number }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
export const ICON = {
  check: "M5 12l5 5L20 7",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7v1",
  warning: "M12 3L2 21h20L12 3zM12 10v5M12 18v1",
  error: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15 9l-6 6M9 9l6 6",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  back: "M15 6l-6 6 6 6",
};
/** 상태 칩: 색 + 아이콘 + 글자를 함께 보여 준다. */
export function StatusChip({ tone, children }: { tone: Tone; children: ReactNode }) {
  const icon = { draft: null, pending: ICON.clock, done: ICON.check, error: ICON.error, neutral: null }[tone];
  return (
    <span className="ui-status" data-tone={tone}>
      {tone === "draft" && <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--primary)", display: "inline-block" }} />}
      {icon && <Svg d={icon} size={12} />}
      {children}
    </span>
  );
}
/** 안내문: 한 줄만 보이고 나머지는 "자세히"로 접힌다. 법적 의미가 있는 문장은 지우지 말고 여기 안에 둔다. */
export function Notice({ tone = "info", summary, children, role }: { tone?: "info" | "warning" | "error"; summary: ReactNode; children?: ReactNode; role?: string }) {
  const icon = tone === "warning" ? ICON.warning : tone === "error" ? ICON.error : ICON.info;
  if (!children) return <p className="ui-notice" data-tone={tone} role={role}><span style={{ display: "flex", gap: 8, alignItems: "flex-start" }}><Svg d={icon} />{summary}</span></p>;
  return (
    <details className="ui-notice" data-tone={tone} role={role}>
      <summary><Svg d={icon} />{summary}<span className="ui-notice-more">자세히</span></summary>
      {children}
    </details>
  );
}
/** 내부 식별자·해시·버전·JSON 이력은 여기로 접는다. */
export function TechDetails({ summary = "기술 정보", children }: { summary?: ReactNode; children: ReactNode }) {
  return <details className="ui-tech"><summary>{summary}</summary>{children}</details>;
}
/** 번호 있는 섹션 카드. */
export function Section({ no, title, aside, children, id, level = 2 }: { no?: number | string; title: ReactNode; aside?: ReactNode; children: ReactNode; id?: string; level?: 2 | 3 }) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <section className="ui-section" id={id}>
      <div className="ui-section-head">
        {no !== undefined && <span className="ui-section-no" aria-hidden="true">{no}</span>}
        <H>{title}</H>
        {aside && <span className="ui-section-aside">{aside}</span>}
      </div>
      <div className="ui-section-body">{children}</div>
    </section>
  );
}
/** 화면 머리: 뒤로 · 제목 · 상태 칩 · 오른쪽 동작. */
export function PageHeader({ back, onBack, backDisabled, title, status, children, level = 2 }: { back?: string; onBack?: () => void; backDisabled?: boolean; title: ReactNode; status?: ReactNode; children?: ReactNode; level?: 1 | 2 }) {
  const H = level === 1 ? "h1" : "h2";
  return (
    <div className="ui-page-head">
      {back && onBack && <button type="button" className="ui-back" disabled={backDisabled} onClick={onBack}><Svg d={ICON.back} />{back}</button>}
      <H>{title}</H>
      {status}
      {children && <div className="ui-page-actions">{children}</div>}
    </div>
  );
}
/** 화면 하단 고정 동작 바. 확정·저장 버튼은 여기 한 곳에만 둔다. */
export function ActionBar({ note, children }: { note?: ReactNode; children: ReactNode }) {
  return <div className="ui-actionbar">{children}{note && <span className="ui-actionbar-note">{note}</span>}</div>;
}
/** 저장 결과 한 줄. role은 기존 화면과 같이 status/alert를 유지한다. */
export function StatusBar({ tone = "info", children, role }: { tone?: "info" | "success" | "error" | "warning"; children: ReactNode; role?: "status" | "alert" }) {
  const icon = tone === "success" ? ICON.check : tone === "error" ? ICON.error : tone === "warning" ? ICON.warning : ICON.info;
  return <p className="ui-statusbar" data-tone={tone} role={role ?? (tone === "error" ? "alert" : "status")}><Svg d={icon} />{children}</p>;
}
export function EmptyState({ illustration = "no-records", title, children }: { illustration?: "no-records" | "offline" | "all-done"; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="ui-empty">
      <img src={`/illustrations/${illustration}.svg`} alt="" />
      <strong>{title}</strong>
      {children && <span>{children}</span>}
    </div>
  );
}
/** 라벨 + 입력 + 도움말 + 오류. children은 input/textarea/select 하나. */
export function Field({ label, htmlFor, help, error, required, children }: { label: ReactNode; htmlFor?: string; help?: ReactNode; error?: ReactNode; required?: boolean; children: ReactNode }) {
  return (
    <div className="ui-field" data-invalid={error ? "true" : undefined}>
      <label htmlFor={htmlFor}>{label}{required && <span className="ui-required"> · 필수</span>}</label>
      {children}
      {help && <span className="ui-help">{help}</span>}
      {error && <span className="ui-field-error" role="alert">{error}</span>}
    </div>
  );
}
export { Svg as UiIcon };
/** 이 페이지에서 찾기: narrows the rows already on screen (one page of 50); not a server search. */
export const matchesFind = (row: unknown, q: string) => !q.trim() || JSON.stringify(row).toLowerCase().includes(q.trim().toLowerCase());
export function PageFind({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="page-find">
      이 페이지에서 찾기
      <input type="search" maxLength={100} value={value} onChange={(e) => onChange(e.target.value)} placeholder="제목·날짜·이름" />
    </label>
  );
}
