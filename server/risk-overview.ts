import type { Express } from "express";
import { z } from "zod";
import type { Db } from "./db.js";
import { date } from "./validation.js";
import { HttpError, type SiteOperations } from "./site-operations.js";

export const riskOverviewMethods = ["product", "three_level", "checklist", "narrative"] as const;
export type RiskOverviewMethod = (typeof riskOverviewMethods)[number];
export const riskOverviewQuery = z.object({
  asOfDate: date,
  method: z.enum(riskOverviewMethods).optional(),
}).strict();
export type RiskOverviewQuery = z.infer<typeof riskOverviewQuery>;
export type RiskDocumentCounts = Record<"draft" | "submitted" | "accepted" | "returned", number>;
export type RiskDueCounts = { beforeDate: number; onDate: number; afterDate: number };
export type RiskActionCounts = Record<"assigned" | "reported" | "verified", RiskDueCounts>;
export type RiskOverviewGroup = {
  method: RiskOverviewMethod;
  documents: { currentLeaf: RiskDocumentCounts; priorWithSuccessor: RiskDocumentCounts };
  actions: { currentLeaf: RiskActionCounts; priorWithSuccessor: RiskActionCounts };
};
export type RiskOverview = {
  siteId: string;
  asOfDate: string;
  method: RiskOverviewMethod | null;
  generatedAt: string;
  groups: RiskOverviewGroup[];
};
const documentCounts = (): RiskDocumentCounts => ({ draft: 0, submitted: 0, accepted: 0, returned: 0 });
const dueCounts = (): RiskDueCounts => ({ beforeDate: 0, onDate: 0, afterDate: 0 });
const actionCounts = (): RiskActionCounts => ({ assigned: dueCounts(), reported: dueCounts(), verified: dueCounts() });
const lineage = (hasSuccessor: number) => hasSuccessor === 0 ? "currentLeaf" : "priorWithSuccessor";
const invalid = () => new HttpError(409, "현황 집계에 필요한 방법·날짜·연결 정보가 불완전합니다. 일부 자료를 제외하지 않고 중단했습니다.");

// Internal: caller owns the read transaction and authorization.
export function buildRiskOverview(db: Db, siteId: string, q: RiskOverviewQuery): RiskOverview {
    const groups: RiskOverviewGroup[] = riskOverviewMethods
      .filter((method) => !q.method || method === q.method)
      .map((method) => ({ method, documents: { currentLeaf: documentCounts(), priorWithSuccessor: documentCounts() }, actions: { currentLeaf: actionCounts(), priorWithSuccessor: actionCounts() } }));
    const methodExpression = "CASE WHEN json_valid(d.body) THEN json_extract(d.body,'$.method') ELSE NULL END";
    // Validate all relevant site methods before optional filtering, so corrupted records are not silently hidden.
    const documents = db.prepare(`SELECT ${methodExpression} method,d.status,d.successor_id IS NOT NULL hasSuccessor,COUNT(*) n FROM risk_assessments d WHERE d.site_id=? GROUP BY method,d.status,hasSuccessor`).all(siteId) as { method: string | null; status: string; hasSuccessor: number; n: number }[];
    for (const row of documents) {
      if (!riskOverviewMethods.includes(row.method as RiskOverviewMethod) || !["draft", "submitted", "accepted", "returned"].includes(row.status)) throw invalid();
      const group = groups.find((g) => g.method === row.method);
      if (group) group.documents[lineage(row.hasSuccessor)][row.status as keyof RiskDocumentCounts] = row.n;
    }
    const actions = db.prepare(`SELECT ${methodExpression} method,a.status,d.successor_id IS NOT NULL hasSuccessor,
      CASE WHEN length(a.due)!=10 OR a.due NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' OR date(a.due,'+0 days') IS NULL OR date(a.due,'+0 days')!=a.due THEN 'invalid'
        WHEN a.due<? THEN 'beforeDate' WHEN a.due=? THEN 'onDate' ELSE 'afterDate' END dueBucket,
      COUNT(*) n FROM risk_actions a LEFT JOIN risk_assessments d ON d.id=a.assessment_id AND d.site_id=a.site_id
      WHERE a.site_id=? GROUP BY method,a.status,hasSuccessor,dueBucket`).all(q.asOfDate, q.asOfDate, siteId) as { method: string | null; status: string; hasSuccessor: number; dueBucket: string; n: number }[];
    for (const row of actions) {
      if (!riskOverviewMethods.includes(row.method as RiskOverviewMethod) || !["assigned", "reported", "verified"].includes(row.status) || !["beforeDate", "onDate", "afterDate"].includes(row.dueBucket)) throw invalid();
      const group = groups.find((g) => g.method === row.method);
      if (group) group.actions[lineage(row.hasSuccessor)][row.status as keyof RiskActionCounts][row.dueBucket as keyof RiskDueCounts] = row.n;
    }
    return { siteId, asOfDate: q.asOfDate, method: q.method ?? null, groups, generatedAt: new Date().toISOString() };
}
/** Current stored states only. The selected day compares due dates; it is not a historical snapshot. */
export function readRiskOverview(db: Db, siteId: string, query: RiskOverviewQuery, authorize: () => void): RiskOverview {
  const q = riskOverviewQuery.parse(query);
  db.exec("BEGIN DEFERRED");
  try {
    authorize();
    const result = buildRiskOverview(db, siteId, q);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function registerRiskOverview(app: Express, db: Db, { access }: SiteOperations) {
  app.get("/api/sites/:siteId/risk-overview", (req, res) => {
    access(req);
    const q = riskOverviewQuery.parse(req.query);
    res.json(readRiskOverview(db, String(req.params.siteId), q, () => { access(req); }));
  });
}
