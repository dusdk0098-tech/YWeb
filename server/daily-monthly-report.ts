import { z } from "zod";
import type { Db } from "./db.js";
import { date } from "./validation.js";
import { HttpError } from "./site-operations.js";
import { journalHash } from "./daily-journal-sources.js";
import type { DailySnapshot } from "./daily-journal-model.js";
export const journalMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .refine(
    (v) => date.safeParse(v + "-01").success,
    "올바른 달력 월이 필요합니다.",
  );
export const monthQuery = z.object({ month: journalMonth }).strict();
type Version = {
  id: string;
  date: string;
  status: "draft" | "archived";
  version: number;
  parent_id: string | null;
};
export type MonthlyDay = {
  date: string;
  rootId: string | null;
  versionCount: number;
  archived: {
    journalId: string;
    version: number;
    revisionNumber: number;
    hash: string;
    archivedAt: string;
    workSummary: string;
    workLocations: string;
    patrolCount: number;
    source: DailySnapshot["source"];
  } | null;
  pendingDraft: {
    id: string;
    version: number;
    kind: "unarchived_root" | "pending_correction";
  } | null;
};
export function buildMonthlyReport(db: Db, siteId: string, month: string) {
  const site = db
    .prepare("SELECT id,name FROM sites WHERE id=?")
    .get(siteId) as { id: string; name: string } | undefined;
  if (!site) throw new HttpError(404, "현장을 찾을 수 없습니다.");
  // Calendar calculation only. The caller supplies the month; server clock does not choose work dates.
  const calendar = new Date(month + "-01T00:00:00Z");
  calendar.setUTCMonth(calendar.getUTCMonth() + 1);
  calendar.setUTCDate(0);
  const dayCount = calendar.getUTCDate();
  const first = month + "-01",
    last = month + "-" + String(dayCount).padStart(2, "0");
  const rows = db
    .prepare(
      "SELECT id,date,status,version,parent_id FROM daily_journals WHERE site_id=? AND date>=? AND date<=? ORDER BY date,id LIMIT 2001",
    )
    .all(siteId, first, last) as Version[];
  if (rows.length > 2000)
    throw new HttpError(
      400,
      "월간 일지 버전이2,000건을 넘어 전체 조회를 중단합니다. 단건 일지를 확인하세요.",
    );
  const grouped = new Map<string, Version[]>();
  for (const r of rows) {
    const list = grouped.get(r.date) || [];
    list.push(r);
    grouped.set(r.date, list);
  }
  const days: MonthlyDay[] = [];
  let selectedTbmRefs = 0;
  for (let d = 1; d <= dayCount; d++) {
    const day = month + "-" + String(d).padStart(2, "0"),
      versions = grouped.get(day) || [],
      roots = versions.filter((v) => v.parent_id === null);
    if (!versions.length) {
      days.push({
        date: day,
        rootId: null,
        versionCount: 0,
        archived: null,
        pendingDraft: null,
      });
      continue;
    }
    if (roots.length !== 1)
      throw new HttpError(
        409,
        "일지 최초 기록 연결이 일치하지 않습니다. 월간 조회를 중단합니다.",
      );
    const children = new Map<string, Version>();
    for (const v of versions) {
      if (v.parent_id) {
        if (children.has(v.parent_id))
          throw new HttpError(409, "일지 정정본이 분기되어 있습니다.");
        children.set(v.parent_id, v);
      }
    }
    const visited = new Set<string>();
    let current: Version | undefined = roots[0],
      selected: Version | undefined,
      selectedRevision = 0,
      draft: Version | undefined;
    while (current) {
      if (visited.has(current.id))
        throw new HttpError(409, "일지 연결 순환이 있습니다.");
      visited.add(current.id);
      if (current.status === "archived") {
        selected = current;
        selectedRevision = visited.size;
      } else {
        draft = current;
        if (children.has(current.id))
          throw new HttpError(
            409,
            "미보관 초안의 후속 연결이 올바르지 않습니다.",
          );
      }
      current = children.get(current.id);
    }
    if (visited.size !== versions.length)
      throw new HttpError(
        409,
        "일지 일부 버전이 최초 기록에 연결되지 않았습니다.",
      );
    let archived: MonthlyDay["archived"] = null;
    if (selected) {
      const stored = db
        .prepare(
          "SELECT body,hash FROM daily_journal_snapshots WHERE journal_id=?",
        )
        .get(selected.id) as { body: string; hash: string } | undefined;
      if (!stored)
        throw new HttpError(
          409,
          "보관 일지 snapshot이 없어 월간 조회를 중단합니다.",
        );
      const s = JSON.parse(stored.body) as DailySnapshot;
      if (
        s.id !== selected.id ||
        s.site.id !== siteId ||
        s.date !== day ||
        s.version !== selected.version ||
        s.source?.facts.siteId !== siteId ||
        s.source?.facts.date !== day ||
        journalHash(s.source.facts) !== s.source.fingerprint ||
        journalHash(s) !== stored.hash
      )
        throw new HttpError(
          409,
          "보관 일지 snapshot의 출처/해시가 일치하지 않습니다.",
        );
      selectedTbmRefs += s.source.facts.tbm.length;
      if (selectedTbmRefs > 1000)
        throw new HttpError(
          400,
          "선택된 월간 TBM 참조가1,000건을 넘어 전체 조회를 중단합니다. 단건 일지를 확인하세요.",
        );
      archived = {
        journalId: selected.id,
        version: selected.version,
        revisionNumber: selectedRevision,
        hash: stored.hash,
        archivedAt: s.archivedAt,
        workSummary: s.body.workSummary,
        workLocations: s.body.workLocations,
        patrolCount: s.body.patrols.length,
        source: s.source,
      };
    }
    days.push({
      date: day,
      rootId: roots[0].id,
      versionCount: versions.length,
      archived,
      pendingDraft: draft
        ? {
            id: draft.id,
            version: draft.version,
            kind: selected ? "pending_correction" : "unarchived_root",
          }
        : null,
    });
  }
  const report = {
    site,
    month,
    calendarDays: dayCount,
    counts: {
      daysWithArchived: days.filter((d) => d.archived).length,
      noJournalDays: days.filter((d) => !d.rootId).length,
      unarchivedRootDays: days.filter(
        (d) => d.pendingDraft?.kind === "unarchived_root",
      ).length,
      pendingCorrectionDays: days.filter(
        (d) => d.pendingDraft?.kind === "pending_correction",
      ).length,
    },
    days,
  };
  return {
    ...report,
    fingerprint: journalHash(report),
    generatedAt: new Date().toISOString(),
  };
}
// Read transaction only: no monthly row, receipt, event, lock state or approval is created.
export function readMonthlyJournals(db: Db, siteId: string, month: string) {
  journalMonth.parse(month);
  db.exec("BEGIN DEFERRED");
  try {
    const report = buildMonthlyReport(db, siteId, month);
    db.exec("COMMIT");
    return report;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export type MonthlyJournalReport = ReturnType<typeof readMonthlyJournals>;
