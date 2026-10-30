import { useState } from "react";
import { api, type Site } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import { WorkPlanPicker } from "./WorkPlanPicker";
import { CompanyPpeHistory } from "./CompanyPpeHistory";
import type { Company, WorkerCompany } from "./company-ppe-types";
export function WorkerCompanyPanel({
  site,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [source, setSource] = useState<WorkerCompany | null>(null),
    [company, setCompany] = useState<Company | null>(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const base = `/sites/${site.id}`,
    dirty = !!source && (company?.id !== source.company?.id || !!reason),
    guard = useDraftGuard(dirty, busy, onDirtyChange, onBusyChange);
  async function selectWorker(id: string) {
    if (!guard.canLeave()) return;
    setBusy(true);
    setError("");
    try {
      const v = await api<WorkerCompany>(`${base}/workers/${id}/company`);
      setSource(v);
      setCompany(v.company);
      setReason("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function selectCompany(id: string) {
    setBusy(true);
    setError("");
    try {
      setCompany(await api<Company>(`${base}/companies/${id}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!source || busy) return;
    setBusy(true);
    setError("");
    const path = `${base}/workers/${source.worker.id}/company`,
      body = {
        version: source.version,
        workerVersion: source.worker.version,
        companyId: company?.id || null,
        reason,
      };
    try {
      const v = await api<WorkerCompany>(
        path,
        "PUT",
        body,
        guard.key(path, body),
      );
      setSource(v);
      setCompany(v.company);
      setReason("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h2>명부의 현재 업체 연결</h2>
      <p>
        이 연결은 관리자의 수기 분류입니다. 기존 명부의 자유입력 소속과 과거
        출역·교육·지급 snapshot은 바꾸지 않습니다. 소급 고용관계/신원 인증이
        아닙니다.
      </p>
      {error && <p role="alert">{error}</p>}
      <WorkPlanPicker
        path={base + "/workers"}
        label="명부 대상 선택"
        disabled={busy}
        onSelect={(id) => void selectWorker(id)}
      />
      {source && (
        <>
          <section className="panel">
            <h3>
              {source.worker.name} · {source.worker.active ? "활성" : "비활성"}
            </h3>
            <p>명부 UUID {source.worker.id}</p>
            <p>기존 자유입력 소속: {source.worker.affiliation || "없음"}</p>
            <p>
              현재 연결: {source.company?.name || "미연결"} · 연결 버전{" "}
              {source.version}
            </p>
            <button
              disabled={busy}
              onClick={() => void selectWorker(source.worker.id)}
            >
              최신 연결 다시 조회
            </button>
          </section>
          {site.role === "manager" && (
            <>
              <WorkPlanPicker
                path={base + "/companies?active=true"}
                label="연결할 활성 업체"
                disabled={busy}
                onSelect={(id) => void selectCompany(id)}
              />
              <form
                className="panel"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <p>저장할 업체: {company?.name || "연결 해제"}</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setCompany(null)}
                >
                  연결 해제 선택
                </button>
                <label>
                  연결/해제 사유
                  <textarea
                    required
                    maxLength={1000}
                    value={reason}
                    disabled={busy}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button disabled={busy}>소속 연결 기록 저장</button>
              </form>
            </>
          )}
          <CompanyPpeHistory
            key={source.worker.id}
            path={`${base}/workers/${source.worker.id}/company`}
            version={source.version}
          />
        </>
      )}
    </>
  );
}
