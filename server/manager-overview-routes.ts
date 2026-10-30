import type { Express } from "express";
import { z } from "zod";
import type { Db } from "./db.js";
import { overviewQuery, readManagerOverview } from "./manager-overview.js";
import { printManagerOverview } from "./manager-overview-print.js";
import { HttpError } from "./site-operations.js";
export function registerManagerOverview(app: Express, db: Db) {
  app.get("/api/manager-overview", (req, res) =>
    res.json(
      readManagerOverview(
        db,
        req.session.userId!,
        overviewQuery.parse(req.query),
      ),
    ),
  );
  app.get("/api/manager-overview/print", (req, res) => {
    const q = overviewQuery
      .extend({ expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(req.query);
    const report = readManagerOverview(db, req.session.userId!, q);
    if (report.fingerprint !== q.expectedFingerprint)
      throw new HttpError(
        409,
        "조회 범위 또는 기록이 변경되었습니다. 현황을 새로 조회한 후 인쇄하세요.",
      );
    res.type("html").send(printManagerOverview(report));
  });
}
