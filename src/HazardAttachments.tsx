import { useEffect, useRef, useState } from "react";
import { api, uploadHazardAttachment } from "./api";
import type { HazardRecord } from "./hazard-types";
type Attachment = {
  id: string;
  filename: string;
  size: number;
  sha256: string;
  attached: number;
  uploaded_at: string;
};
type Result = { record: HazardRecord; attachments: Attachment[] };
export function HazardAttachments({
  siteId,
  record,
  editable,
  disabled,
  onBusy,
  onDirty,
  onRecord,
}: {
  siteId: string;
  record: HazardRecord;
  editable: boolean;
  disabled: boolean;
  onBusy: (v: boolean) => void;
  onDirty: (v: boolean) => void;
  onRecord: (v: HazardRecord) => void;
}) {
  const [items, setItems] = useState<Attachment[]>([]),
    [error, setError] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const command = useRef<{ signature: string; key: string } | null>(null),
    input = useRef<HTMLInputElement>(null);
  const base = `/sites/${siteId}/hazards/${record.id}/attachments`;
  useEffect(() => {
    let active = true;
    api<Attachment[]>(base)
      .then((v) => {
        if (active) {
          setItems(v);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [base, record.version]);
  useEffect(() => {
    onDirty(!!file || !!reason);
    return () => onDirty(false);
  }, [file, reason, onDirty]);
  async function change(item?: Attachment) {
    if (busy || disabled || (!item && !file)) return;
    if (
      !window.confirm(
        item
          ? "첨부 연결 상태를 변경할까요? 분리해도 원본은 보존되고 용량을 차지합니다."
          : "악성코드/이미지 내부 형식을 검사하지 않은 원본을 저장합니다. 개인·민감정보가 없는 파일인지 직접 확인했나요?",
      )
    )
      return;
    const signature = JSON.stringify({
      id: item?.id,
      attached: item ? !item.attached : null,
      reason,
      version: record.version,
      file: file ? [file.name, file.size, file.lastModified] : null,
    });
    if (command.current?.signature !== signature)
      command.current = { signature, key: crypto.randomUUID() };
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      const result = item
        ? await api<Result>(
            base + `/${item.id}/state`,
            "POST",
            { version: record.version, attached: !item.attached, reason },
            command.current.key,
          )
        : await uploadHazardAttachment<Result>(
            base,
            file!,
            record.version,
            command.current.key,
          );
      setItems(result.attachments);
      onRecord(result.record);
      command.current = null;
      if (item) setReason("");
      else {
        setFile(null);
        if (input.current) input.current.value = "";
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <section>
      <h3>신고 원본 첨부 · 다운로드만</h3>
      <p className="notice">
        UNSCANNED · PNG/JPEG 파일 헤더만 확인합니다. 실제 이미지 해석·악성코드
        검사·진위 인증은 하지 않습니다. 미리보기/자동 열기 없음. 출처를 신뢰하지
        못하는 파일은 내려받거나 열지 마세요. 해시는 보관된 바이트 비교값이지
        전자서명/안전 인증이 아닙니다.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {editable && (
        <fieldset disabled={busy || disabled}>
          <label>
            원본 PNG/JPEG (5 MiB 이하, 개인정보 제외)
            <input
              ref={input}
              type="file"
              accept=".png,.jpg,.jpeg"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                command.current = null;
              }}
            />
          </label>
          <button
            type="button"
            disabled={!file || !!reason}
            onClick={() => void change()}
          >
            미검사 원본 업로드
          </button>
          <label>
            분리/재연결 사유
            <input
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </fieldset>
      )}
      <p className="muted">
        신고당 보존 20개(분리 포함). 분리는 삭제/용량 회수가 아닙니다. 제출 시
        연결 목록은 고정됩니다. 현장200개/100MiB·전체512MiB 보존 한도는 회의록/작업계획/비용/교육 원본과 합산합니다. 업로드 전 다른 신고 입력을 저장하세요.
      </p>
      <ul>
        {items.map((a) => (
          <li key={a.id}>
            <strong>{a.filename}</strong> · {a.size} bytes ·{" "}
            {a.attached ? "연결됨" : "분리됨 · 원본 보존"}
            <p className="muted">SHA-256 {a.sha256}</p>
            <a
              className="button secondary"
              href={`/api${base}/${a.id}/download`}
              download
              onClick={(e) => {
                if (
                  !window.confirm(
                    "미검사 원본입니다. 출처를 신뢰하며 다운로드할까요? 앱은 파일을 검사하거나 자동으로 열지 않습니다.",
                  )
                )
                  e.preventDefault();
              }}
            >
              경고 확인 후 원본 다운로드
            </a>
            {editable && (
              <button
                type="button"
                className="secondary"
                disabled={busy || disabled || !reason.trim() || !!file}
                onClick={() => void change(a)}
              >
                {a.attached ? "연결 분리 (보존)" : "다시 연결"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {!items.length && <p>보존 첨부 없음</p>}
    </section>
  );
}
