import type { Express, Request } from "express";
import { z } from "zod";
import type { Db } from "./db.js";
import type { SiteOperations } from "./site-operations.js";
import { getCostPeriod, costExpenses, type CostCategory } from "./cost-model.js";
import { buildEvidenceRequestView, evidenceRequestInput, selectEvidenceRequest } from "./cost-evidence-request.js";
import { currentCostEvidence } from "./cost-evidence-model.js";
export function registerCostEvidenceRequests(app: Express, db: Db, { access }: SiteOperations) {
  const base = "/api/sites/:siteId/cost-periods/:id/evidence";
  function read<T>(req: Request, action: (v: ReturnType<typeof buildEvidenceRequestView>) => T): T {
    db.exec("BEGIN DEFERRED");
    try {
      access(req, true, true);
      const site = String(req.params.siteId), id = String(req.params.id), period = getCostPeriod(db, site, id);
      const view = buildEvidenceRequestView(currentCostEvidence(db, site, id), costExpenses(db, id), JSON.parse(period.categories) as CostCategory[]);
      const value = action(view); db.exec("COMMIT"); return value;
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  }
  app.get(base + "/request-candidates", (req, res) => {
    const q = z.object({ offset: z.coerce.number().int().min(0).max(1000000).default(0) }).strict().parse(req.query);
    const result = read(req, v => ({ ...v, rows: v.rows.slice(q.offset, q.offset + 50), total: v.rows.length,
      offset: q.offset, hasMore: v.rows.length > q.offset + 50 }));
    res.set("Cache-Control", "no-store").json(result);
  });
  app.post(base + "/request-preview", (req, res) => {
    const body = evidenceRequestInput.parse(req.body);
    res.set("Cache-Control", "no-store").json(read(req, v => selectEvidenceRequest(v, body)));
  });
}
