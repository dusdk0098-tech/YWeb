import { InspectionUsePanel } from "./InspectionUsePanel";
import { useRef, useState } from "react";
import { api, type Site } from "./api";
import type { InspectionTemplate } from "./inspection-types";
import { useDraftGuard } from "./useDraftGuard";
export function InspectionTemplateEditor({
  site,
  initial,
  onClose,
  onDirtyChange,
  onBusyChange,
}: {
  site: Site;
  initial: InspectionTemplate | null;
  onClose: () => void;
  onDirtyChange: (v: boolean) => void;
  onBusyChange: (v: boolean) => void;
}) {
  const [record, setRecord] = useState(initial),
    [title, setTitle] = useState(initial?.body.title || ""),
    [instructions, setInstructions] = useState(
      initial?.body.instructions || "",
    ),
    [items, setItems] = useState(
      initial?.body.items.map((i) => i.text) || [""],
    ),
    [useDirty,setUseDirty]=useState(false),[useBusy,setUseBusy]=useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const body = { title, instructions, items },
    baseline = useRef(JSON.stringify(body)),
    dirty = JSON.stringify(body) !== baseline.current;
  const guard = useDraftGuard(dirty||useDirty, busy||useBusy, onDirtyChange, onBusyChange),
    editable =
      site.role === "manager" && (!record || record.status === "draft");
  async function run(action: "save" | "publish" | "revise") {
    if (busy||useBusy||useDirty) return;
    if (action !== "save" && dirty) {
      setError("초안 변경을 먼저 저장하세요.");
      return;
    }
    setBusy(true);
    setError("");
    const path = `/sites/${site.id}/inspection-templates${record ? "/" + record.id : ""}${action === "save" ? "" : "/" + action}`,
      value =
        action === "save"
          ? { ...body, ...(record ? { version: record.version } : {}) }
          : { version: record!.version };
    try {
      const next = await api<InspectionTemplate>(
        path,
        action === "save" && record ? "PUT" : "POST",
        value,
        guard.key(path, value),
      );
      setRecord(next);
      setTitle(next.body.title);
      setInstructions(next.body.instructions);
      setItems(next.body.items.map((i) => i.text));
      baseline.current = JSON.stringify({
        title: next.body.title,
        instructions: next.body.instructions,
        items: next.body.items.map((i) => i.text),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      {record&&<InspectionUsePanel key={record.id+":"+record.version} siteId={site.id} templateId={record.id} canStop={site.role==="manager"&&record.status==="published"} disabled={busy||dirty} onDirtyChange={setUseDirty} onBusyChange={setUseBusy}/>}
      <div className="section-head">
        <h1>
          자체 점검 양식{" "}
          {record?.status === "published" ? "· 게시됨" : "· 초안"}
        </h1>
        <button
          className="secondary"
          disabled={busy||useBusy}
          onClick={() => guard.canLeave() && onClose()}
        >
          양식 목록으로
        </button>
      </div>
      <p>
        직접 작성한 업무 양식입니다. 법정 서식 또는 안전 인증이 아닙니다. 게시된
        버전은 변경할 수 없으며 후속 버전을 생성합니다.
      </p>
      {record && (
        <p>
          양식 ID {record.id} · 저장 버전 {record.version} · 이전 양식{" "}
          {record.parent_id || "없음"}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <fieldset disabled={busy || !editable}>
        <label>
          양식 제목
          <input
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          작성 안내
          <textarea
            maxLength={3000}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </label>
        {items.map((text, index) => (
          <div key={index}>
            <label>
              항목 {index + 1}
              <input
                maxLength={500}
                value={text}
                onChange={(e) =>
                  setItems(
                    items.map((v, i) => (i === index ? e.target.value : v)),
                  )
                }
              />
            </label>
            <button
              type="button"
              className="secondary"
              disabled={items.length <= 1}
              onClick={() => setItems(items.filter((_, i) => i !== index))}
            >
              항목 삭제
            </button>
          </div>
        ))}
        <button
          className="secondary"
          disabled={items.length >= 100}
          onClick={() => setItems([...items, ""])}
        >
          항목 추가 (최대 100)
        </button>
      </fieldset>
      <div className="actions">
        {editable && (
          <button disabled={busy||useBusy||useDirty} onClick={() => run("save")}>
            양식 초안 저장
          </button>
        )}
        {editable && record && (
          <button
            disabled={busy || dirty}
            onClick={() =>
              window.confirm(
                "현재 항목을 변경 불가능한 양식 버전으로 게시할까요?",
              ) && run("publish")
            }
          >
            양식 게시
          </button>
        )}
        {site.role === "manager" && record?.status === "published" && (
          <button disabled={busy||useBusy||useDirty} onClick={() => run("revise")}>
            후속 양식 초안 생성
          </button>
        )}
      </div>
    </section>
  );
}
