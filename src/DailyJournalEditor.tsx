import { deleteDraft, loadDraft, saveDraft } from "./offline-draft";
import { DailyJournalToday } from "./DailyJournalToday";
import { DailyInspectionReferences,DailyInspectionCaptured } from "./DailyInspectionReferences";
import { useEffect, useRef, useState } from "react";
import { api, type Site, type User } from "./api";
import { useDraftGuard } from "./useDraftGuard";
import type { Page } from "./attendance-types";
import type { DailyBody, DailyJournal } from "./daily-journal-types";
import { DailyJournalSources } from "./DailyJournalSources";
const blank = (): DailyBody => ({
  workSummary: "",
  workLocations: "",
  safetyInstructions: "",
  observations: "",
  followupNotes: "",
  patrols: [],
});
export function DailyJournalEditor({
  site,
  user,
  initial,
  onDirtyChange,
  onBusyChange,
  onClose,
  onRevision,
}: {
  site: Site;
  user: User;
  initial: DailyJournal | null;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
  onClose: () => void;
  onRevision: (r: DailyJournal) => void;
}) {
  const [record, setRecord] = useState(initial),
    [body, setBody] = useState(initial?.body || blank()),
    [day, setDay] = useState(
      initial?.date || new Date().toLocaleDateString("en-CA"),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reason, setReason] = useState(""),
    [authorId, setAuthorId] = useState(""),
    [authors, setAuthors] = useState<{ id: string; name: string }[]>([]),
    [eventOffset, setEventOffset] = useState(0),
    [moreEvents, setMoreEvents] = useState(false),
    [events, setEvents] = useState<
      {
        version: number;
        event: string;
        actor_id: string;
        actor_name: string;
        at: string;
        note: string;
      }[]
    >([]);
  const initialDay = useRef(day),
    initialBody = useRef(body),
    base = `/sites/${site.id}/daily-journals`,
    manager = site.role === "manager",
    editable =
      site.role !== "viewer" &&
      (!record || (record.status === "draft" && record.author_id === user.id));
  const formDirty =
      JSON.stringify(body) !==
        JSON.stringify(record?.body || initialBody.current) ||
      day !== (record?.date || initialDay.current),
    actionDirty = !!reason || !!authorId,
    dirty = formDirty || actionDirty;
  const [inspectionBusy,setInspectionBusy]=useState(false);
  const allBusy=busy||inspectionBusy;
  const guard = useDraftGuard(dirty, allBusy, onDirtyChange, onBusyChange);
  // 오프라인 초안: an encrypted copy on this device while the form differs from the server (cleared after a successful save).
  const draftId = `journal:${site.id}:${user.id}:${record?.id ?? "new"}`,
    [localDraft, setLocalDraft] = useState<{ value: { body: typeof body; day: string }; savedAt: string } | null>(null);
  useEffect(() => {
    if (!editable) return;
    let active = true;
    void loadDraft<{ body: typeof body; day: string }>(draftId).then((d) => {
      if (active && d && JSON.stringify(d.value.body) !== JSON.stringify(record?.body || initialBody.current)) setLocalDraft(d);
    });
    return () => { active = false; };
  }, [draftId]); // checked once per opened record
  useEffect(() => {
    if (!editable || !formDirty) return;
    const t = setTimeout(() => void saveDraft(draftId, { body, day }), 800);
    return () => clearTimeout(t);
  }, [editable, formDirty, draftId, body, day]);
  useEffect(() => {
    if (!manager) return;
    let active = true;
    api<{ id: string; name: string }[]>(base + "/authors")
      .then((v) => {
        if (active) setAuthors(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [base, manager, record?.version]);
  useEffect(() => {
    if (!record) return;
    let active = true;
    api<Page<(typeof events)[number]>>(
      base + `/${record.id}/events?offset=${eventOffset}`,
    )
      .then((v) => {
        if (active) {
          setEvents(v.items);
          setMoreEvents(v.hasMore);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [base, record?.id, record?.version, eventOffset]);
  function adopt(r: DailyJournal) {
    setRecord(r);
    setBody(r.body);
    setDay(r.date);
    setReason("");
    setAuthorId("");
    setEventOffset(0);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const path = record ? base + "/" + record.id : base,
      value = record ? { version: record.version, body } : { date: day, body };
    setBusy(true);
    setError("");
    try {
      adopt(
        await api<DailyJournal>(
          path,
          record ? "PUT" : "POST",
          value,
          guard.key(path, value),
        ),
      );
      void deleteDraft(draftId);
      setLocalDraft(null);
    } catch (e) {
      setError(e instanceof TypeError
        ? "통신이 끊겨 서버에 저장하지 못했습니다. 입력은 이 기기에 암호화해 7일간 보관합니다. 연결되면 다시 저장하세요."
        : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function command(action: "capture" | "archive" | "revise") {
    if (!record || busy) return;
    const path = base + `/${record.id}/${action}`,
      value =
        action === "revise"
          ? { version: record.version, reason, authorId }
          : { version: record.version };
    const question =
      action === "capture"
        ? "선택 날짜의 수기 출역 집계와 TBM 확정 버전 참조를 새로 가져올까요? 원자료를 인증하거나 수정하지 않습니다."
        : action === "archive"
          ? "관리자로서 기록을 보관할까요? 본문·참조는 고정되며 이후 정정은 새 초안입니다. 안전/법적 승인이나 본인서명이 아닙니다."
          : "이전 보관본을 유지하고 새 정정 초안을 만들까요? 같은 날짜, 자료 참조는 다시 가져와야 합니다.";
    if (!window.confirm(question)) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<DailyJournal>(
        path,
        "POST",
        value,
        guard.key(path, value),
      );
      if (action === "revise") onRevision(r);
      else adopt(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    if (!record || !guard.canLeave()) return;
    setBusy(true);
    setError("");
    try {
      adopt(await api<DailyJournal>(base + "/" + record.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function linked(id: string) {
    if (!guard.canLeave()) return;
    setBusy(true);
    setError("");
    try {
      onRevision(await api<DailyJournal>(base + "/" + id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="section-head">
        <h2>
          {record?.status === "archived"
            ? "관리자가 보관한 안전업무일지"
            : "안전업무일지 초안"}
        </h2>
        <button
          className="secondary"
          disabled={allBusy}
          onClick={() => {
            if (guard.canLeave()) onClose();
          }}
        >
          일지 목록으로
        </button>
      </div>
      <p className="notice">
        사용자가 선택한 날짜의 수기 안전업무일지입니다. 임금/근로시간/고용·교육
        이수·법적 승인·서명을 자동 판정하지 않습니다. 순찰 지적/조치는 직접
        입력한 설명이며 실제 위험 제거를 보증하지 않습니다.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {localDraft && (
        <p role="status">
          이 기기에 저장 안 된 초안이 있습니다({new Date(localDraft.savedAt).toLocaleString()}).
          <button type="button" onClick={() => { setBody(localDraft.value.body); if (!record) setDay(localDraft.value.day); setLocalDraft(null); }}>기기 초안 복원</button>
          <button type="button" onClick={() => { void deleteDraft(draftId); setLocalDraft(null); }}>기기 초안 버리기</button>
        </p>
      )}
      <form onSubmit={save}>
        <fieldset disabled={!editable || allBusy}>
          <label>
            일지 날짜 (저장 후 고정)
            <input
              type="date"
              required
              disabled={!!record || busy}
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </label>
          {editable && <DailyJournalToday siteId={site.id} date={day} />}
          <h3>3. 관찰·조치 입력</h3>
          <label>
            작업 요약 · 보관 시 필수
            <textarea
              rows={4}
              maxLength={5000}
              value={body.workSummary}
              onChange={(e) =>
                setBody({ ...body, workSummary: e.target.value })
              }
            />
          </label>
          <label>
            작업 장소
            <input
              maxLength={1000}
              value={body.workLocations}
              onChange={(e) =>
                setBody({ ...body, workLocations: e.target.value })
              }
            />
          </label>
          <label>
            안전 안내 기록 · 보관 시 필수
            <textarea
              rows={4}
              maxLength={5000}
              value={body.safetyInstructions}
              onChange={(e) =>
                setBody({ ...body, safetyInstructions: e.target.value })
              }
            />
          </label>
          <label>
            관찰 사항
            <textarea
              maxLength={5000}
              value={body.observations}
              onChange={(e) =>
                setBody({ ...body, observations: e.target.value })
              }
            />
          </label>
          <h3>수기 순찰 · 지적 · 개선 기록 (최대20항목)</h3>
          {body.patrols.map((p, i) => (
            <fieldset key={i}>
              <legend>순찰 {i + 1}</legend>
              <label>
                순찰 장소
                <input
                  required
                  maxLength={200}
                  value={p.location}
                  onChange={(e) =>
                    setBody({
                      ...body,
                      patrols: body.patrols.map((v, j) =>
                        j === i ? { ...v, location: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <label>
                지적/관찰 내용
                <textarea
                  required
                  maxLength={1000}
                  value={p.finding}
                  onChange={(e) =>
                    setBody({
                      ...body,
                      patrols: body.patrols.map((v, j) =>
                        j === i ? { ...v, finding: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <label>
                직접 기록한 개선/요청 내용
                <textarea
                  maxLength={1000}
                  value={p.action}
                  onChange={(e) =>
                    setBody({
                      ...body,
                      patrols: body.patrols.map((v, j) =>
                        j === i ? { ...v, action: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  if (
                    window.confirm(
                      "이 초안의 순찰 입력 항목을 제거할까요? 아직 보관된 기록은 아닙니다.",
                    )
                  )
                    setBody({
                      ...body,
                      patrols: body.patrols.filter((_, j) => j !== i),
                    });
                }}
              >
                초안 순찰 항목 제거
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            className="secondary"
            disabled={body.patrols.length >= 20}
            onClick={() =>
              setBody({
                ...body,
                patrols: [
                  ...body.patrols,
                  { location: "", finding: "", action: "" },
                ],
              })
            }
          >
            수기 순찰 항목 추가
          </button>
          <label>
            후속 업무 메모
            <textarea
              maxLength={5000}
              value={body.followupNotes}
              onChange={(e) =>
                setBody({ ...body, followupNotes: e.target.value })
              }
            />
          </label>
          <h3>4. 참조 확인</h3>
          <label><input type="checkbox" checked={body.inspectionReferences!==undefined} onChange={e=>{if(!e.target.checked&&!window.confirm('미저장 점검 선택과 메모를 제거할까요?'))return;const next={...body};if(e.target.checked)next.inspectionReferences=[];else delete next.inspectionReferences;setBody(next);}}/>같은 날 점검 제출본 참조</label>
          {body.inspectionReferences&&<DailyInspectionReferences siteId={site.id} date={day} value={body.inspectionReferences} onChange={v=>setBody({...body,inspectionReferences:v})} onBusy={setInspectionBusy}/>}
        </fieldset>
        {editable && <h3>5. 저장·보관</h3>}
        {editable && (
          <button disabled={allBusy || actionDirty || (!formDirty && !!record)}>
            일지 초안 저장
          </button>
        )}
      </form>
      {record && (
        <>
          <p className="muted">
            일지 {record.id} · {record.date} · v{record.version} · 작성 계정{" "}
            {record.author_id}
          </p>
          <div className="actions">
            <button
              className="secondary"
              disabled={allBusy}
              onClick={() => void reload()}
            >
              일지 최신본 불러오기
            </button>
            <a
              className="button secondary"
              href={`/api${base}/${record.id}/print`}
              target="_blank"
              rel="noreferrer"
            >
              일지 인쇄 / PDF
            </a>
          </div>
          {(record.snapshot?.body.source||record.source_capture)?.facts.inspectionReferences&&<DailyInspectionCaptured items={(record.snapshot?.body.source||record.source_capture)!.facts.inspectionReferences!}/>}
          <DailyJournalSources
            source={record.snapshot?.body.source || record.source_capture}
            siteId={site.id}
          />
          {editable && (
            <button
              disabled={allBusy || dirty}
              onClick={() => void command("capture")}
            >
              해당일 자료 참조 갱신
            </button>
          )}
          {manager && record.status === "draft" && (
            <>
              <p className="notice">
                보관 직전에 해당일 관련 원자료가 바뀌었으면409로 중단합니다. 원
                작성자가 참조를 갱신해야 합니다. 작성 계정이 철회됐다면
                관리자에게 현재 권한 회복 여부 판단이 필요합니다. 자동 작성자
                변경 없음.
              </p>
              <button
                disabled={allBusy || dirty || !record.source_capture}
                onClick={() => void command("archive")}
              >
                관리자가 일지 기록 보관
              </button>
            </>
          )}
          {record.snapshot && (
            <p className="muted">
              보관 {record.snapshot.body.archivedAt} ·{" "}
              {record.snapshot.body.archivedBy.name} (
              {record.snapshot.body.archivedBy.id}) · SHA-256{" "}
              {record.snapshot.hash}
            </p>
          )}
          {record.parent_id && (
            <button
              className="secondary"
              disabled={allBusy}
              onClick={() => void linked(record.parent_id!)}
            >
              이전 보관 일지 열기
            </button>
          )}
          {record.successorId ? (
            <button
              className="secondary"
              disabled={allBusy}
              onClick={() => void linked(record.successorId!)}
            >
              기존 정정 일지 열기
            </button>
          ) : (
            manager &&
            record.status === "archived" && (
              <fieldset disabled={allBusy}>
                <h3>새 정정 초안 (이전 보관본 유지)</h3>
                <label>
                  일지 정정 사유
                  <textarea
                    maxLength={1000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <label>
                  정정 초안 작성 계정
                  <select
                    value={authorId}
                    onChange={(e) => setAuthorId(e.target.value)}
                  >
                    <option value="">현재 현장 작성자/관리자 선택</option>
                    {authors.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {a.id}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  disabled={!reason.trim() || !authorId}
                  onClick={() => void command("revise")}
                >
                  사유 있는 새 정정 초안
                </button>
              </fieldset>
            )
          )}
          <h3>이 일지의 처리 이력</h3>
          <p className="muted">
            초안 본문/이전 취합 전체 버전은 보관하지 않습니다. 보관 시점의
            본문·참조 snapshot과 처리 메타데이터를 보존합니다.
          </p>
          {events.map((e) => (
            <p key={e.version}>
              v{e.version} · {e.event} · {e.actor_name} ({e.actor_id}) · {e.at}
              <br />
              {e.note}
            </p>
          ))}
          <div className="actions">
            <button
              className="secondary"
              disabled={allBusy || !eventOffset}
              onClick={() => setEventOffset((v) => Math.max(0, v - 50))}
            >
              이전 이력50
            </button>
            <button
              className="secondary"
              disabled={allBusy || !moreEvents}
              onClick={() => setEventOffset((v) => v + 50)}
            >
              다음 이력50
            </button>
          </div>
        </>
      )}
      <p role="status">
        {dirty
          ? "저장하지 않은 일지 입력"
          : record
            ? "서버에 저장됨"
            : "새 일지"}
      </p>
    </section>
  );
}
