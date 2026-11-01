import { useState } from "react";
import type { Site } from "./api";
import { LibraryPanel, NoticesPanel } from "./DomainPanels";
// 공지 + 자료실 = "공지 · 자료" (UI_REDESIGN_PLAN 결정 8): one menu entry, two kinds of record; the records stay apart.
export function NoticesLibraryPanel(props: { site: Site; onDirtyChange: (v: boolean) => void; onBusyChange: (v: boolean) => void }) {
  const [kind, setKind] = useState<"notices" | "library">("notices");
  return (
    <>
      <div className="segmented" role="group" aria-label="종류">
        <button type="button" aria-pressed={kind === "notices"} className={kind === "notices" ? "" : "secondary"} onClick={() => setKind("notices")}>공지</button>
        <button type="button" aria-pressed={kind === "library"} className={kind === "library" ? "" : "secondary"} onClick={() => setKind("library")}>자료실</button>
      </div>
      {kind === "notices" ? <NoticesPanel key={props.site.id} {...props} /> : <LibraryPanel key={props.site.id} site={props.site} />}
    </>
  );
}
