import { useEffect, useRef, useState } from "react";
import { api, uploadWorkPlanAttachment } from "./api";
import type { WorkPlan } from "./work-plan-types";
type Attachment = {
  id: string;
  filename: string;
  size: number;
  sha256: string;
  attached: number;
  uploaded_at: string;
};
type Result = { record: WorkPlan; attachments: Attachment[] };
export function WorkPlanAttachments({
  siteId,
  record,
  editable,
  disabled,
  onBusy,
  onDirty,
  onRecord,
}: {
  siteId: string;
  record: WorkPlan;
  editable: boolean;
  disabled: boolean;
  onBusy: (v: boolean) => void;
  onDirty: (v: boolean) => void;
  onRecord: (v: WorkPlan) => void;
}) {
  const [items, setItems] = useState<Attachment[]>([]),
    [error, setError] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded,setLoaded]=useState(false),
    [events,setEvents]=useState<{version:number;event:string;actor_name:string;at:string;reason:string}[]|null>(null);
  const command = useRef<{ signature: string; key: string } | null>(null),
    input = useRef<HTMLInputElement>(null);
  const base = `/sites/${siteId}/work-plans/${record.id}/attachments`;
  useEffect(() => {
    let active = true;
    setLoaded(false);
    api<Attachment[]>(base)
      .then((v) => {
        if (active) {
          setItems(v);
          setLoaded(true);
          setError("");
        }
      })
      .catch((e) => {
        if (active) {setItems([]);setError(e.message);}
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
          : "악성코드/이미지·PDF 내부 형식을 검사하지 않은 원본을 저장합니다. 개인·민감정보가 없는 파일인지 직접 확인했나요?",
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
        : await uploadWorkPlanAttachment<Result>(
            base,
            file!,
            record.version,
            command.current.key,
          );
      setItems(result.attachments);
      setLoaded(true);
      setEvents(null);
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
      <h3>작업계획 원본 첨부 · 다운로드만</h3>
      <p>현재 작성 계정의 저장된 초안에서만 첨부를 변경합니다. 다른 관리자는 기존 기록 보관 권한이 있어도 첨부를 대신 변경할 수 없습니다. 제출/보관 시 연결 목록을 고정합니다. 반려/정정은 첨부 없는 새 초안이며 이전 원본은 연결 원본에서 확인합니다.</p>
      {record.status === "archived" && (record.snapshot?.body.attachmentManifest
        ? <p>문서 해시에 결속된 고정 연결 목록: {record.snapshot.body.attachmentManifest.items.length}개 · {record.snapshot.hash}</p>
        : <p>이 과거 고정본은 첨부 manifest를 기록하지 않은 형식입니다. 당시 첨부가 없었다고 새로 판정하지 않습니다.</p>)}
      {record.status === "draft" && <p>초안 텍스트 인쇄에는 고정 첨부 목록이 없습니다. 제출 또는 기록 보관 때 연결 목록을 고정합니다.</p>}
      <p className="notice">
        UNSCANNED · PNG/JPEG/PDF 시작 헤더만 확인합니다. 헤더만 맞는 손상·위장 파일도 저장될 수 있습니다. PDF 구조·암호·스크립트 및 이미지 해석·악성코드
        검사·진위 인증은 하지 않습니다. 미리보기/자동 열기 없음. 출처를 신뢰하지
        못하는 파일은 내려받거나 열지 마세요. 해시는 보관된 바이트 비교값이지
        전자서명/안전 인증이 아닙니다. 다운로드 후 여는 프로그램의 동작은 앱이 통제하지 않습니다.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {editable && (
        <fieldset disabled={busy || disabled}>
          <label>
            원본 PNG/JPEG/PDF (5 MiB 이하, 개인정보 제외)
            <input
              ref={input}
              type="file"
              accept=".png,.jpg,.jpeg,.pdf"
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
        작업계획당 보존 20개(분리 포함). 분리는 삭제/용량 회수가 아닙니다. 제출/보관 시
        연결 목록은 고정됩니다. 분리한 원본도 현재 현장의 모든 읽기 계정이 다운로드할 수 있으며 비공개 처리나 삭제가 아닙니다. 현장 보존200개/100MiB, 전체512MiB는 신고/회의록 첨부와 합산하며 비용·교육 원본도 포함합니다. 업로드 전 다른 작업계획 입력을 저장하세요.
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
                    "미검사 원본입니다. 출처를 신뢰하며 다운로드할까요? 앱은 파일을 검사하거나 자동으로 열지 않습니다. 안전한 파일임을 뜻하지 않으며 다운로드 후 여는 프로그램의 동작은 앱이 통제하지 않습니다.",
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
      {loaded&&!items.length && <p>보존 첨부 없음</p>}
      {!loaded&&!error&&<p>첨부 목록 조회 중</p>}
      <button type="button" disabled={busy} onClick={()=>{setEvents(null);void api<{items:{version:number;event:string;actor_name:string;at:string;reason:string}[];hasMore:boolean}>(base+"/events?offset=0").then(v=>setEvents(v.items)).catch(e=>setError(e.message));}}>최근 첨부 이력 50개 조회</button>
      {events&&events.map(e=><p key={e.version}>v{e.version} · {e.event} · {e.actor_name} · {e.at} · {e.reason}</p>)}
      {record.parent_id&&<p>반려/정정 초안에는 이전 첨부를 자동 복사하지 않습니다. 이전 제출/보관본에서 보존 원본을 확인하세요.</p>}
      {editable&&(file||reason)&&<button type="button" disabled={busy||disabled} onClick={()=>{if(confirm("미저장 파일 선택과 사유 입력을 버릴까요?")){setFile(null);setReason("");command.current=null;if(input.current)input.current.value="";}}}>미저장 첨부 입력 버리기</button>}
    </section>
  );
}
