import { validateFixedDailyInspections } from "./daily-inspection-references.js";
import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import type { DailyBody } from "./daily-journal-validation.js";
import type { DailyCapture } from "./daily-journal-sources.js";
export type DailyRow = {
  id: string;
  site_id: string;
  date: string;
  body: string;
  status: "draft" | "archived";
  version: number;
  author_id: string;
  parent_id: string | null;
  revision_reason: string;
  source_capture: string | null;
  created_at: string;
  updated_at: string;
};
export type DailySnapshot = {
  id: string;
  date: string;
  version: number;
  site: { id: string; name: string };
  author: { id: string; name: string };
  parentId: string | null;
  revisionReason: string;
  body: DailyBody;
  source: DailyCapture;
  archivedBy: { id: string; name: string };
  archivedAt: string;
};
export const dailyRecord = (r: DailyRow) => ({
  ...r,
  body: JSON.parse(r.body) as DailyBody,
  source_capture: r.source_capture
    ? (JSON.parse(r.source_capture) as DailyCapture)
    : null,
});
export function getDaily(db: Db, site: string, id: string) {
  const r = db
    .prepare("SELECT * FROM daily_journals WHERE site_id=? AND id=?")
    .get(site, id) as DailyRow | undefined;
  if (!r) throw new HttpError(404, "업무일지를 찾을 수 없습니다.");
  return r;
}
export function fullDaily(db: Db, row: DailyRow) {
  const snap = db
    .prepare("SELECT body,hash FROM daily_journal_snapshots WHERE journal_id=?")
    .get(row.id) as { body: string; hash: string } | undefined;
  const child = db
    .prepare("SELECT id FROM daily_journals WHERE parent_id=? AND site_id=?")
    .get(row.id, row.site_id) as { id: string } | undefined;
  if(snap){const fixed=JSON.parse(snap.body) as DailySnapshot;if(fixed.source.facts.inspectionReferences)validateFixedDailyInspections(fixed.source.facts.inspectionReferences,fixed.date);}
  return {
    ...dailyRecord(row),
    snapshot: snap
      ? { body: JSON.parse(snap.body) as DailySnapshot, hash: snap.hash }
      : null,
    successorId: child?.id || null,
  };
}
