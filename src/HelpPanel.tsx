import type { Site } from "./api";
import { CURRENT_SCHEMA_VERSION } from "../server/schema-version";
import { helpDestinationAllowed, helpTopics, type HelpDestination } from "./help-topics";
export function HelpPanel({ site, onNavigate, disabled = false }: { site?: Site; onNavigate: (destination: HelpDestination) => void; disabled?: boolean }) {
  const topics = site ? helpTopics : helpTopics.filter(t => t.id === "start");
  return <section className="panel"><h1>사용 도움말</h1>
    <p>{site ? `${site.name} · 현재 현장의 업무 안내입니다.` : "현장이 선택되지 않았습니다. 먼저 계정과 현장 배정을 확인하세요."}</p>
    <p>화면 이동만 안내하며 기록을 저장·수정하거나 권한을 바꾸지 않습니다.</p>
    {topics.map(topic => <article key={topic.id}><h2>{topic.title}</h2><ol>{topic.steps.map(step => <li key={step}>{step}</li>)}</ol><p><strong>주의:</strong> {topic.caution}</p>
      {topic.id === "backup" && <p>이 개발본 지원 DB 버전: {CURRENT_SCHEMA_VERSION}. 지원 명령 확인: <code>npm run backup:local -- --help</code> (설명만 표시, 실행하지 않음)</p>}
      {topic.shortcuts.filter(s => helpDestinationAllowed(s.destination, site?.role)).map(shortcut => <button key={shortcut.destination} disabled={disabled} onClick={() => onNavigate(shortcut.destination)}>{shortcut.label} 열기</button>)}
    </article>)}
  </section>;
}
