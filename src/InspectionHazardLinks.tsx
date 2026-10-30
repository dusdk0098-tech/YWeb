import { useEffect, useRef, useState } from "react";
import { api, type Site } from "./api";
import type { Inspection } from "./inspection-types";
import type { InspectionLink } from "../server/inspection-links";
import { statusLabel } from "./hazard-types";
export function InspectionHazardLinks({
  site,
  record,
  busy,
  onBusyChange,
  onOpen,
}: {
  site: Site;
  record: Inspection;
  busy: boolean;
  onBusyChange: (v: boolean) => void;
  onOpen: (id: string) => Promise<void>;
}) {
  const [links, setLinks] = useState<InspectionLink[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false);
  const command = useRef<{ signature: string; key: string } | null>(null);
  const path = `/sites/${site.id}/inspections/${record.id}/hazard-links`;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<InspectionLink[]>(path)
      .then((v) => {
        if (active) setLinks(v);
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
  }, [path]);
  const failed =
    record.submitted_snapshot?.body.answers.filter(
      (a) => a.result === "fail",
    ) || [];
  async function create(itemId: string) {
    if (busy || working) return;
    if (
      !window.confirm(
        "이 부적합의 출처를 고정하고 별도 신고 초안을 만들까요? 자동 제출·조치 완료는 하지 않습니다.",
      )
    )
      return;
    setWorking(true);
    onBusyChange(true);
    setError("");
    const value = { version: record.version, itemId },
      signature = JSON.stringify(value);
    if (command.current?.signature !== signature)
      command.current = { signature, key: crypto.randomUUID() };
    try {
      const link = await api<InspectionLink>(
        path,
        "POST",
        value,
        command.current.key,
      );
      setLinks((v) => [...v.filter((x) => x.id !== link.id), link]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
      onBusyChange(false);
    }
  }
  async function open(id: string) {
    if (busy || working) return;
    setWorking(true);
    onBusyChange(true);
    setError("");
    try {
      await onOpen(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
      onBusyChange(false);
    }
  }
  return (
    <section className="panel">
      <h2>부적합 → 신고 연결</h2>
      <p>
        검토 수락된 점검의 부적합만 관리자가 명시적으로 신고 초안으로
        연결합니다. 출처는 변경되지 않으며 신고 제출·조치·종결은 별도
        처리합니다. 연결은 원 점검 결과나 실제 안전을 자동 변경/보증하지
        않습니다.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {loading ? (
        <p>연결 조회 중…</p>
      ) : (
        <>
          {failed.map((a) => {
            const item = record.submitted_snapshot!.template.body.items.find(
                (i) => i.id === a.itemId,
              )!,
              link = links.find((l) => l.item_id === a.itemId);
            return (
              <article key={a.itemId}>
                <h3>{item.text}</h3>
                <p>{a.comment}</p>
                {link ? (
                  <>
                    <p>
                      연결 신고 {link.hazard_id} ·{" "}
                      {statusLabel[link.hazard_status]}
                    </p>
                    <button
                      disabled={busy || working}
                      onClick={() => open(link.hazard_id)}
                    >
                      연결 신고 열기
                    </button>
                    <a
                      href={`/api/sites/${site.id}/hazards/${link.hazard_id}/print`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      연결 신고 인쇄
                    </a>
                  </>
                ) : site.role === "manager" && record.status === "accepted" ? (
                  <button
                    disabled={busy || working}
                    onClick={() => create(a.itemId)}
                  >
                    이 부적합으로 신고 초안 만들기
                  </button>
                ) : (
                  <p>연결 없음 · 검토 수락 후 관리자만 생성 가능</p>
                )}
              </article>
            );
          })}
          {failed.length === 0 && <p>제출된 부적합 항목이 없습니다.</p>}
        </>
      )}
    </section>
  );
}
