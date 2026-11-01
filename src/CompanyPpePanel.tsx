import { useCallback, useState } from "react";
import { PageHeader } from "./ui";
import type { Site } from "./api";
import { CompaniesPanel } from "./CompaniesPanel";
import { WorkerCompanyPanel } from "./WorkerCompanyPanel";
import { PpePanel } from "./PpePanel";
export function CompanyPpePanel({
  site,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [tab, setTab] = useState("companies"),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false);
  const changed = useCallback(
      (v: boolean) => {
        setDirty(v);
        onDirtyChange(v);
      },
      [onDirtyChange],
    ),
    working = useCallback(
      (v: boolean) => {
        setBusy(v);
        onBusyChange(v);
      },
      [onBusyChange],
    );
  function navigate(next: string) {
    if (next === tab || busy) return;
    if (
      dirty &&
      !window.confirm(
        "저장하지 않은 업체/소속/보호구 입력을 버리고 이동할까요?",
      )
    )
      return;
    setTab(next);
    changed(false);
  }
  const props = { site, onDirtyChange: changed, onBusyChange: working };
  return (
    <>
      <PageHeader level={1} title="업체 · 보호구" />
      <div className="form-actions">
        <button disabled={busy} onClick={() => navigate("companies")}>
          업체 등록부
        </button>
        <button disabled={busy} onClick={() => navigate("affiliation")}>
          명부 업체 연결
        </button>
        {site.role === "manager" && (
          <button disabled={busy} onClick={() => navigate("ppe")}>
            보호구 지급·반납
          </button>
        )}
      </div>
      {tab === "companies" ? (
        <CompaniesPanel {...props} />
      ) : tab === "affiliation" ? (
        <WorkerCompanyPanel {...props} />
      ) : site.role === "manager" ? (
        <PpePanel {...props} />
      ) : (
        <p>관리자 전용 원장입니다.</p>
      )}
    </>
  );
}
