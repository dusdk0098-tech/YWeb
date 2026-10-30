import type { Express } from "express";
import type { Db } from "./db.js";
import type { SiteOperations } from "./site-operations.js";
import { costSearchQuery, readCostSearch } from "./cost-search.js";
export function registerCostSearch(
  app: Express,
  db: Db,
  { access }: SiteOperations,
) {
  app.get("/api/sites/:siteId/cost-expense-search", (req, res) => {
    access(req, true, true);
    res.json(
      readCostSearch(
        db,
        String(req.params.siteId),
        req.session.userId!,
        costSearchQuery.parse(req.query),
      ),
    );
  });
}
