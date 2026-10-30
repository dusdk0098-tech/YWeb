import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { inspectionPage } from "./inspection-validation.js";
import { account } from "./inspection-model.js";
import { stockItem } from "./stock-model.js";
import { stockText, stockUnits } from "./stock-quantity.js";
import { journalHash } from "./daily-journal-sources.js";
import { minimumDetail, minimumPage, minimumRow, validMinimum, type StockMinimumRow, type StockMinimumSnapshot } from "./stock-minimum-model.js";
const common = { expectedConfigVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1),
  expectedItemVersion: z.number().int().positive(), reason: z.string().trim().min(1).max(1000), confirm: z.literal(true) };
export const minimumInput = z.discriminatedUnion("enabled", [
  z.object({ ...common, enabled: z.literal(true), minimum: z.string().max(24) }).strict(),
  z.object({ ...common, enabled: z.literal(false) }).strict(),
]);
export function registerStockMinimums(app: Express, db: Db, { access, mutate }: SiteOperations) {
  const base = "/api/sites/:siteId/stock-items/:id/minimum";
  const read = <T>(action: () => T) => {
    db.exec("BEGIN DEFERRED");
    try { const result = action(); db.exec("COMMIT"); return result; }
    catch (e) { db.exec("ROLLBACK"); throw e; }
  };
  app.get("/api/sites/:siteId/stock-minimums", (req, res) => {
    access(req, true, true);
    const q = inspectionPage.parse(req.query);
    res.json(read(() => minimumPage(db, String(req.params.siteId), q.offset)));
  });
  app.get(base, (req, res) => {
    access(req, true, true);
    res.json(read(() => minimumDetail(db, String(req.params.siteId), String(req.params.id))));
  });
  app.get(base + "/history", (req, res) => {
    access(req, true, true);
    const q = inspectionPage.parse(req.query);
    res.json(read(() => {
      const item = stockItem(db, String(req.params.siteId), String(req.params.id));
      const rows = db.prepare("SELECT * FROM stock_minimum_events WHERE item_id=? ORDER BY version DESC LIMIT 51 OFFSET ?")
        .all(item.id, q.offset) as StockMinimumRow[];
      return { items: rows.slice(0, 50).map(row => validMinimum(row, item)), hasMore: rows.length > 50 };
    }));
  });
  app.post(base, (req, res) => {
    access(req, true, true);
    const input = minimumInput.parse(req.body);
    const v = input.enabled ? { ...input, minimum: stockText(stockUnits(input.minimum, true)) } : input;
    const site = String(req.params.siteId), id = String(req.params.id);
    mutate(req, res, `stock:minimum:${site}:${id}`, v, () => {
      const item = stockItem(db, site, id), previous = minimumRow(db, id);
      if (item.version !== v.expectedItemVersion || (previous?.version || 0) !== v.expectedConfigVersion)
        throw new HttpError(409, "품목 또는 최소재고 설정이 변경되었습니다. 입력을 보관하고 최신본을 확인하세요.");
      if (previous) validMinimum(previous, item);
      if (!v.enabled && (!previous || !validMinimum(previous, item).snapshot.enabled))
        throw new HttpError(409, "현재 활성 설정이 없어 해제하지 않았습니다.");
      const actor = account(db, req.session.userId!);
      const snapshot: StockMinimumSnapshot = { schemaVersion: 1, id: randomUUID(), version: v.expectedConfigVersion + 1,
        item: { id, siteId: site, name: item.name, unit: item.unit, version: item.version },
        enabled: v.enabled, minimum: v.enabled ? v.minimum : null, reason: v.reason,
        actor: { id: actor.id, name: actor.name }, at: new Date().toISOString() };
      const hash = journalHash(snapshot);
      db.prepare("INSERT INTO stock_minimum_events VALUES(?,?,?,?,?)")
        .run(snapshot.id, id, snapshot.version, JSON.stringify(snapshot), hash);
      audit(db, actor.id, site, "stock.minimum", id);
      return { snapshot, hash };
    }, () => { access(req, true, true); });
  });
}
