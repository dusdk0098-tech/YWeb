import type { Express } from "express";
import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { monthQuery, readMonthlyJournals } from "./daily-monthly-report.js";
import { printMonthlyJournals } from "./daily-monthly-print.js";
export function registerDailyMonthlyReports(
  app: Express,
  db: Db,
  { access }: SiteOperations,
) {
  const base = "/api/sites/:siteId/daily-journal-months";
  app.get(base, (req, res) => {
    access(req);
    const q = monthQuery.parse(req.query);
    res.json(readMonthlyJournals(db, String(req.params.siteId), q.month));
  });
  app.get(base + "/print", (req, res) => {
    access(req);
    const q = monthQuery
      .extend({
        expectedFingerprint: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .parse(req.query);
    const report = readMonthlyJournals(db, String(req.params.siteId), q.month);
    if (q.expectedFingerprint && q.expectedFingerprint !== report.fingerprint)
      throw new HttpError(
        409,
        "조회 후 관련 일지/현장 표시가 변경되었습니다. 월간 화면을 다시 조회한 후 인쇄하세요.",
      );
    res.type("html").send(printMonthlyJournals(report));
  });
}
