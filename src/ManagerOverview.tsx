import { managerWorkflowLines } from "../server/manager-overview-text";
import { useEffect, useState } from "react";
import { api, type Site } from "./api";
import type { ManagerOverview as Report } from "../server/manager-overview";
function localDay() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function ManagerOverview({
  sites,
  onOpen,
}: {
  sites: Site[];
  onOpen: (siteId: string, module: string) => void;
}) {
  const [day, setDay] = useState(localDay),
    [selected, setSelected] = useState(""),
    [costMonth, setCostMonth] = useState(""),
    [offset, setOffset] = useState(0),
    [tick, setTick] = useState(0);
  const [report, setReport] = useState<Report | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [permissions, setPermissions] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    api<{ warnings: string[] }>("/local-permissions").then((v) => active && setPermissions(v.warnings)).catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const query = new URLSearchParams({
    asOfDate: day,
    offset: String(offset),
    ...(selected ? { siteIds: selected } : {}),
    ...(costMonth ? {costMonth} : {}),
  }).toString();
  useEffect(() => {
    let active = true;
    setReport(null);
    setError("");
    if (!day) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api<Report>("/manager-overview?" + query)
      .then((r) => {
        if (active) setReport(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [day, query, tick]);
  return (
    <section className="panel">
      <h1>관리 현장 기록 현황</h1>
      {permissions.length > 0 && (
        <section role="alert">
          <h2>이 PC의 데이터 파일 권한 확인 필요 (SEC-LOCAL-01)</h2>
          <ul>{permissions.map((w) => <li key={w}>{w}</li>)}</ul>
          <p>앱은 권한을 자동으로 바꾸지 않습니다. 데이터 폴더를 앱을 실행하는 계정만 읽을 수 있게 운영자가 직접 정리하세요(docs/OPERATIONS.md 점검표).</p>
        </section>
      )}
      <p>
        현재 관리자 권한이 있는 현장만 조회합니다. 상단 단일 현장 선택과 별도의
        다현장 조회입니다. 기준일 기본값은 브라우저의 현지 달력일이며 직접
        변경할 수 있습니다.
      </p>
      <p>
        현재 기록 상태이며 과거 시점 재현이 아닙니다. 기준일은 일정/후속 예정일 비교와 일지 날짜에 적용됩니다. 비용은 별도로 선택한 월의 현재 원장/마감본입니다. 신고 기록은 실제 위험/해결 판정, 일정은
        실제 점검 완료, 일지 없음은 미작업/미준수 판정이 아닙니다.
      </p>
      <label>비용 조회 월 (선택하지 않으면 비용 조회 없음)<input type="month" value={costMonth} onChange={e=>{setCostMonth(e.target.value);setOffset(0);}}/></label>
      <button onClick={()=>{setCostMonth("");setOffset(0);}}>비용 월 선택 해제</button>
      <label>
        현황 비교 및 일지 기준일
        <input
          type="date"
          value={day}
          onChange={(e) => {
            setDay(e.target.value);
            setOffset(0);
          }}
        />
      </label>
      <label>
        관리 현장 조회 범위
        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">현재 관리 현장 전체 (50개씩)</option>
          {sites
            .filter((s) => s.role === "manager")
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
      </label>
      <button disabled={loading || !day} onClick={() => setTick((t) => t + 1)}>
        현황 새로 조회
      </button>
      {loading && <p role="status">현황 조회 중…</p>}
      {error && (
        <p role="alert">
          {error} 이전 조회 자료는 숨겼습니다. 권한/범위를 확인하고 다시
          조회하세요.
        </p>
      )}
      {report && (
        <>
          <p>
            현재 페이지 {report.sites.length}개 / 허용 조회 범위{" "}
            {report.totalSites}개 · 조회 {report.generatedAt}
          </p>
          <a
            href={
              "/api/manager-overview/print?" +
              query +
              "&expectedFingerprint=" +
              report.fingerprint
            }
            target="_blank"
            rel="noreferrer"
          >
            현재 페이지 현황 인쇄
          </a>
          <p>
            페이지 밖 현장은 이 표/인쇄에 포함하지 않습니다. 현장 간 집계 합산·사람 수·안전 점수는 제공하지 않습니다. 금액은 명시적으로 선택한 같은 월의 현장별 원장만 표시합니다.
          </p>
          {report.sites.length === 0 && (
            <p>이 페이지에는 현재 관리자 권한으로 조회할 현장이 없습니다.</p>
          )}
          {report.sites.map((s) => (
            <article key={s.id}>
              <h2>{s.name}</h2>
              <details><summary>현재 문서/후속과 선택 월 비용</summary>{managerWorkflowLines(s).map((line,i)=><p key={i}>{line}</p>)}<p>현장 문서 대기는 내 검토 가능 목록이 아닙니다. 원장 진입 후 필요한 필터/월을 다시 선택하세요. 예정일 경과는 위법/미이행 판정이 아닙니다.</p><button onClick={()=>onOpen(s.id,"riskcore")}>위험평가 메뉴 열기</button><button onClick={()=>onOpen(s.id,"workplans")}>작업계획 메뉴 열기</button><button onClick={()=>onOpen(s.id,"minutes")}>회의록 메뉴 열기</button><button onClick={()=>onOpen(s.id,"costs")}>비용 메뉴 열기 (월 재선택)</button></details>
              <p>
                신고 초안 제외 기록: 제출 {s.hazards.reported} · 배정{" "}
                {s.hazards.assigned} · 검토요청 {s.hazards.reviewRequested} ·
                기록상 종결 {s.hazards.closed}
              </p>
              <button onClick={() => onOpen(s.id, "hazards")}>
                이 현장 신고 원장 열기
              </button>
              <p>
                미시작 점검 일정: 기준일 전 {s.tasks.beforeDate} · 당일{" "}
                {s.tasks.onDate} · 후 {s.tasks.afterDate} (시작/취소 제외)
              </p>
              <button onClick={() => onOpen(s.id, "inspections")}>
                이 현장 점검 메뉴 열기
              </button>
              <p>
                {s.journal.rootExists
                  ? `기준일 일지 보관 버전 ${s.journal.archivedVersions}개 · 최초 초안 ${s.journal.initialDraft ? "있음" : "없음"} · 정정 초안 ${s.journal.correctionDraft ? "있음" : "없음"}`
                  : "기준일 일지 기록 없음 — 실제 작업 여부 불명"}
              </p>
              <p>
                보관 버전 수는 정정을 포함하며 수행 일수/활동 횟수가 아닙니다.
                보관본과 새 정정 초안이 함께 있을 수 있습니다.
              </p>
              <button onClick={() => onOpen(s.id, "daily")}>
                이 현장 일지 원장 열기
              </button>
            </article>
          ))}
          <button
            disabled={loading || offset === 0}
            onClick={() => {
              setLoading(true);
              setOffset(Math.max(0, offset - 50));
            }}
          >
            이전 현장 50개
          </button>
          <button
            disabled={loading || !report.hasMore}
            onClick={() => {
              setLoading(true);
              setOffset(offset + 50);
            }}
          >
            다음 현장 50개
          </button>
        </>
      )}
    </section>
  );
}
