import { managerWorkflowSummary, managerCostSummary } from "./manager-workflow-summary.js";
import { journalMonth } from "./daily-monthly-report.js";
import { z } from "zod";
import type { Db } from "./db.js";
import { date } from "./validation.js";
import { HttpError } from "./site-operations.js";
import { journalHash } from "./daily-journal-sources.js";
const selectedSites = z
  .string()
  .max(1849)
  .transform((s) => s.split(","))
  .pipe(
    z
      .array(z.uuid())
      .min(1)
      .max(50)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "현장을 중복 선택할 수 없습니다.",
      ),
  );
export const overviewQuery = z
  .object({
    asOfDate: date,
    costMonth: journalMonth.optional(),
    siteIds: selectedSites.optional(),
    offset: z.coerce.number().int().min(0).max(1000000).default(0),
  })
  .strict();
export type OverviewQuery = z.infer<typeof overviewQuery>;
export type OverviewSite = {
  id: string;
  name: string;
  workflow: ReturnType<typeof managerWorkflowSummary>;
  cost?: ReturnType<typeof managerCostSummary>;
  hazards: {
    reported: number;
    assigned: number;
    reviewRequested: number;
    closed: number;
  };
  tasks: { beforeDate: number; onDate: number; afterDate: number };
  journal: {
    rootExists: boolean;
    archivedVersions: number;
    initialDraft: boolean;
    correctionDraft: boolean;
  };
};
export type ManagerOverview = {
  asOfDate: string;
  costMonth?: string;
  offset: number;
  limit: number;
  totalSites: number;
  hasMore: boolean;
  selectedSiteIds: string[] | null;
  sites: OverviewSite[];
  fingerprint: string;
  generatedAt: string;
};
function buildOverview(
  db: Db,
  userId: string,
  q: OverviewQuery,
): ManagerOverview {
  const selected = q.siteIds ? [...q.siteIds].sort() : null;
  if (selected)
    for (const id of selected) {
      const allowed = db
        .prepare(
          "SELECT 1 FROM memberships WHERE user_id=? AND site_id=? AND role='manager'",
        )
        .get(userId, id);
      if (!allowed)
        throw new HttpError(
          403,
          "선택한 모든 현장의 현재 관리자 권한이 필요합니다.",
        );
    }
  const filter = selected
    ? ` AND s.id IN (${selected.map(() => "?").join(",")})`
    : "";
  const args = [userId, ...(selected || [])];
  const total = db
    .prepare(
      "SELECT count(*) AS n FROM sites s JOIN memberships m ON m.site_id=s.id WHERE m.user_id=? AND m.role='manager'" +
        filter,
    )
    .get(...args) as { n: number };
  const sites = db
    .prepare(
      "SELECT s.id,s.name FROM sites s JOIN memberships m ON m.site_id=s.id WHERE m.user_id=? AND m.role='manager'" +
        filter +
        " ORDER BY s.name COLLATE BINARY,s.id LIMIT 50 OFFSET ?",
    )
    .all(...args, q.offset) as { id: string; name: string }[];
  const rows: OverviewSite[] = sites.map((site) => {
    const hazards = db
      .prepare(
        `SELECT count(CASE WHEN status='reported' THEN 1 END) reported,
      count(CASE WHEN status='assigned' THEN 1 END) assigned,
      count(CASE WHEN status='review_requested' THEN 1 END) reviewRequested,
      count(CASE WHEN status='closed' THEN 1 END) closed FROM hazard_reports WHERE site_id=? AND status!='draft'`,
      )
      .get(site.id) as OverviewSite["hazards"];
    const tasks = db
      .prepare(
        `SELECT count(CASE WHEN json_extract(body,'$.plannedDate')<? THEN 1 END) beforeDate,
      count(CASE WHEN json_extract(body,'$.plannedDate')=? THEN 1 END) onDate,
      count(CASE WHEN json_extract(body,'$.plannedDate')>? THEN 1 END) afterDate,
      count(*) total FROM inspection_tasks WHERE site_id=? AND status='planned'`,
      )
      .get(
        q.asOfDate,
        q.asOfDate,
        q.asOfDate,
        site.id,
      ) as OverviewSite["tasks"] & { total: number };
    if (tasks.beforeDate + tasks.onDate + tasks.afterDate !== tasks.total)
      throw new HttpError(
        409,
        "점검 일정의 날짜 자료가 불완전합니다. 원장을 확인하세요.",
      );
    const journals = db
      .prepare(
        `SELECT count(CASE WHEN parent_id IS NULL THEN 1 END) roots,
      count(CASE WHEN status='archived' THEN 1 END) archives,
      count(CASE WHEN status='draft' AND parent_id IS NULL THEN 1 END) initial,
      count(CASE WHEN status='draft' AND parent_id IS NOT NULL THEN 1 END) corrections,
      count(*) total FROM daily_journals WHERE site_id=? AND date=?`,
      )
      .get(site.id, q.asOfDate) as {
      roots: number;
      archives: number;
      initial: number;
      corrections: number;
      total: number;
    };
    if (
      journals.roots > 1 ||
      journals.initial + journals.corrections > 1 ||
      (journals.total > 0 && journals.roots !== 1)
    )
      throw new HttpError(
        409,
        "일지 연결 자료가 불완전합니다. 원장을 확인하세요.",
      );
    return {
      ...site,
      workflow: managerWorkflowSummary(db,site.id,q.asOfDate),
      ...(q.costMonth ? {cost:managerCostSummary(db,site.id,q.costMonth)} : {}),
      hazards,
      tasks: {
        beforeDate: tasks.beforeDate,
        onDate: tasks.onDate,
        afterDate: tasks.afterDate,
      },
      journal: {
        rootExists: journals.roots === 1,
        archivedVersions: journals.archives,
        initialDraft: journals.initial === 1,
        correctionDraft: journals.corrections === 1,
      },
    };
  });
  const facts = {
    asOfDate: q.asOfDate,
    ...(q.costMonth ? {costMonth:q.costMonth} : {}),
    offset: q.offset,
    limit: 50,
    totalSites: total.n,
    hasMore: q.offset + rows.length < total.n,
    selectedSiteIds: selected,
    sites: rows,
  };
  return {
    ...facts,
    fingerprint: journalHash({ userId, ...facts }),
    generatedAt: new Date().toISOString(),
  };
}
export function readManagerOverview(db: Db, userId: string, q: OverviewQuery) {
  db.exec("BEGIN DEFERRED");
  try {
    const report = buildOverview(db, userId, q);
    db.exec("COMMIT");
    return report;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
