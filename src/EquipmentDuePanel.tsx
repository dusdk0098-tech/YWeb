import { useEffect, useState } from "react";
import { api, type Site } from "./api";
import type { Page } from "./attendance-types";
import type { EquipmentRecord } from "./equipment-types";
import type { EquipmentDueBody } from "../server/equipment-due";
import { useDraftGuard } from "./useDraftGuard";
type View = {
  equipment: EquipmentRecord;
  asOfDate: string;
  inspection: string;
  insurance: string;
};
const labels: Record<string, string> = {
  not_recorded: "미입력",
  before_reference: "입력된 기한 경과",
  on_reference: "기준일과 같은 날짜",
  after_reference: "기준일 이후 예정",
};
const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export function EquipmentDuePanel({
  site,
  onClose,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  onClose: () => void;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [asOfDate, setDay] = useState(localDay),
    [offset, setOffset] = useState(0),
    [tick, setTick] = useState(0),
    [page, setPage] = useState<Page<View>>({ items: [], hasMore: false }),
    [editing, setEditing] = useState<EquipmentRecord | null>(null),
    [form, setForm] = useState<EquipmentDueBody>({
      nextInspectionDate: null,
      insuranceRecordedUntil: null,
      sourceNote: "",
    }),
    [reason, setReason] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const guard = useDraftGuard(!!editing, busy, onDirtyChange, onBusyChange);
  useEffect(() => {
    let active = true;
    setPage({ items: [], hasMore: false });
    setError("");
    if (!asOfDate) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api<Page<View>>(
      `/sites/${site.id}/equipment-due?asOfDate=${asOfDate}&offset=${offset}`,
    )
      .then((v) => {
        if (active) setPage(v);
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
  }, [site.id, asOfDate, offset, tick]);
  function edit(r: EquipmentRecord) {
    if (!guard.canLeave()) return;
    setEditing(r);
    setReason("");
    setForm(
      r.dueMetadata || {
        nextInspectionDate: null,
        insuranceRecordedUntil: null,
        sourceNote: "",
      },
    );
  }
  async function save() {
    if (!editing || busy) return;
    const path = `/sites/${site.id}/equipment/${editing.id}/due-metadata`,
      body = { version: editing.version, reason, body: form };
    setBusy(true);
    setError("");
    try {
      await api<EquipmentRecord>(path, "PUT", body, guard.key(path, body));
      setEditing(null);
      setReason("");
      setTick((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <button
        disabled={busy}
        onClick={() => {
          if (guard.canLeave()) onClose();
        }}
      >
        장비 목록으로
      </button>
      <h2>장비 수기 기한 메모</h2>
      <p>
        입력된 날짜 비교일 뿐 검사 합격·보험 유효·운행 가능 판단이 아닙니다.
        기본 비교일은 이 브라우저의 현지 달력 날짜이며 직접 바꿀 수 있습니다.
        서버가 전달받은 기준일로 비교합니다.
      </p>
      <label>
        비교 기준일
        <input
          type="date"
          disabled={busy || !!editing}
          value={asOfDate}
          onChange={(e) => {
            setDay(e.target.value);
            setOffset(0);
          }}
        />
      </label>
      {!asOfDate && <p>비교할 날짜를 선택하세요.</p>}
      {error && (
        <p role="alert">
          {error} 변경 입력은 유지됩니다. 충돌이면 메모를 보관하고 취소 후
          목록을 다시 조회하세요.
        </p>
      )}
      {editing && (
        <fieldset disabled={busy}>
          <legend>
            {editing.body.name} · 기한 메모 정정 (v{editing.version})
          </legend>
          <label>
            입력한 검사 예정일
            <input
              type="date"
              value={form.nextInspectionDate || ""}
              onChange={(e) =>
                setForm({ ...form, nextInspectionDate: e.target.value || null })
              }
            />
          </label>
          <label>
            보험 기록상 종료일
            <input
              type="date"
              value={form.insuranceRecordedUntil || ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  insuranceRecordedUntil: e.target.value || null,
                })
              }
            />
          </label>
          <label>
            수기 출처 메모
            <textarea
              maxLength={1000}
              value={form.sourceNote}
              onChange={(e) => setForm({ ...form, sourceNote: e.target.value })}
            />
          </label>
          <label>
            기한 메모 변경 사유
            <textarea
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <p>
            날짜를 비우면 사유와 함께 미입력으로 정정합니다. 증권번호/개인정보를
            쓰지 마세요. 자동 주기 계산·알림·외부 검증은 없습니다.
          </p>
          <button disabled={!reason.trim()} onClick={() => void save()}>
            기한 메모 저장
          </button>
          <button
            onClick={() => {
              if (guard.canLeave()) {
                setEditing(null);
                setReason("");
              }
            }}
          >
            메모 정정 취소
          </button>
        </fieldset>
      )}
      {loading ? (
        <p>기한 메모 조회 중</p>
      ) : (
        page.items.map((v) => (
          <article key={v.equipment.id}>
            <h3>
              {v.equipment.body.name} ·{" "}
              {v.equipment.status === "active" ? "등록 활성" : "퇴역 기록"}
            </h3>
            <p>비교 기준 {v.asOfDate}</p>
            <p>
              입력한 검사 예정일:{" "}
              {v.equipment.dueMetadata?.nextInspectionDate || "미입력"} ·{" "}
              {labels[v.inspection]}
            </p>
            <p>
              보험 기록상 종료일:{" "}
              {v.equipment.dueMetadata?.insuranceRecordedUntil || "미입력"} ·{" "}
              {labels[v.insurance]}
            </p>
            <p>
              수기 출처 메모: {v.equipment.dueMetadata?.sourceNote || "미기록"}
            </p>
            {site.role === "manager" && (
              <button disabled={busy} onClick={() => edit(v.equipment)}>
                이 장비 기한 정정
              </button>
            )}
            <a
              href={`/api/sites/${site.id}/equipment/${v.equipment.id}/due-metadata/print?asOfDate=${v.asOfDate}`}
              target="_blank"
              rel="noreferrer"
            >
              이 기준일 메모 인쇄
            </a>
          </article>
        ))
      )}
      <button
        disabled={busy || loading || !!editing || offset === 0}
        onClick={() => setOffset((v) => v - 50)}
      >
        이전 50
      </button>
      <button
        disabled={busy || loading || !!editing || !page.hasMore}
        onClick={() => setOffset((v) => v + 50)}
      >
        다음 50
      </button>
      <button
        disabled={busy || loading || !!editing || !asOfDate}
        onClick={() => setTick((v) => v + 1)}
      >
        목록 다시 조회
      </button>
    </section>
  );
}
