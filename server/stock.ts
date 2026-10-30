import { stockWriter } from "./stock-write.js";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { date, revision } from "./validation.js";
import { inspectionPage } from "./inspection-validation.js";
import {
  stockItem,
  stockState,
  stockView,
  type StockItem,
} from "./stock-model.js";
import { stockUnits, stockText } from "./stock-quantity.js";
import { printStock } from "./stock-print.js";
const reason = z.string().trim().min(1).max(1000),
  itemInput = z
    .object({
      name: z.string().trim().min(1).max(200),
      unit: z.string().trim().min(1).max(30),
    })
    .strict(),
  itemEdit = itemInput.extend({ version: revision, reason });
export const movementInput = z
  .object({
    version: revision,
    kind: z.enum(["opening", "receipt", "issue", "adjust_in", "adjust_out"]),
    quantity: z.string().max(24),
    effectiveDate: date,
    reason,
  })
  .strict();
const reversalInput = z
  .object({ version: revision, effectiveDate: date, reason })
  .strict();
export function registerStock(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  const base = "/api/sites/:siteId/stock-items";
  function expected(row: StockItem, version: number) {
    if (row.version !== version)
      throw new HttpError(
        409,
        "품목 버전이 변경되었습니다. 입력을 보관하고 최신본을 다시 여세요.",
      );
  }
  const { event, append } = stockWriter(db);
  app.get(base, (req, res) => {
    access(req, true, true);
    const q = inspectionPage.parse(req.query);
    const rows = db
      .prepare(
        "SELECT * FROM stock_items WHERE site_id=? ORDER BY name,id LIMIT 51 OFFSET ?",
      )
      .all(String(req.params.siteId), q.offset) as StockItem[];
    res.json({ items: rows.slice(0, 50), hasMore: rows.length > 50 });
  });
  app.post(base, (req, res) => {
    access(req, true, true);
    const v = itemInput.parse(req.body),
      site = String(req.params.siteId);
    mutate(
      req,
      res,
      "stock:create:" + site,
      v,
      () => {
        const id = randomUUID(),
          now = new Date().toISOString();
        db.prepare("INSERT INTO stock_items VALUES(?,?,?,?,1,?,?,?)").run(
          id,
          site,
          v.name,
          v.unit,
          req.session.userId!,
          now,
          now,
        );
        return event(req, stockItem(db, site, id), "create", "품목 등록");
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.get(base + "/:id", (req, res) => {
    access(req, true, true);
    res.json(
      stockView(
        db,
        stockItem(db, String(req.params.siteId), String(req.params.id)),
      ),
    );
  });
  app.put(base + "/:id", (req, res) => {
    access(req, true, true);
    const v = itemEdit.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `stock:edit:${site}:${id}`,
      v,
      () => {
        const row = stockItem(db, site, id);
        expected(row, v.version);
        if (row.unit !== v.unit && stockState(db, row).rows.length)
          throw new HttpError(
            409,
            "이동 기록이 있는 품목의 단위는 변경할 수 없습니다. 단위 변환은 지원하지 않습니다.",
          );
        db.prepare(
          "UPDATE stock_items SET name=?,unit=?,version=version+1,updated_at=? WHERE id=?",
        ).run(v.name, v.unit, new Date().toISOString(), id);
        return event(req, stockItem(db, site, id), "edit", v.reason);
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.get(base + "/:id/movements", (req, res) => {
    access(req, true, true);
    const row = stockItem(db, String(req.params.siteId), String(req.params.id)),
      q = inspectionPage.parse(req.query),
      state = stockState(db, row);
    res.json({
      items: state.rows.slice(q.offset, q.offset + 50).map((r) => {
        const costLink=db.prepare("SELECT id FROM cost_stock_receipts WHERE item_id=? AND (movement_id=? OR reversal_movement_id=?)").get(row.id,r.id,r.id) as {id:string}|undefined;
        return {
        ...r,
        item_snapshot: JSON.parse(r.item_snapshot),
        ppeRecordId:
          (
            db
              .prepare(
                "SELECT id FROM ppe_issues WHERE item_id=? AND (issue_movement_id=? OR return_movement_id=?)",
              )
              .get(row.id, r.id, r.id) as { id: string } | undefined
          )?.id || (db.prepare("SELECT issue_id FROM ppe_return_entries WHERE movement_id=?").get(r.id) as {issue_id:string}|undefined)?.issue_id || null,
        ...(costLink ? {costReceiptId:costLink.id} : {}),
        reversedBy: state.rows.find((x) => x.reverses_id === r.id)?.id || null,
      };}),
      hasMore: state.rows.length > q.offset + 50,
    });
  });
  app.get(base + "/:id/events", (req, res) => {
    access(req, true, true);
    const row = stockItem(db, String(req.params.siteId), String(req.params.id)),
      q = inspectionPage.parse(req.query),
      rows = db
        .prepare(
          "SELECT * FROM stock_events WHERE item_id=? ORDER BY version LIMIT 51 OFFSET ?",
        )
        .all(row.id, q.offset) as { data: string }[];
    res.json({
      items: rows.slice(0, 50).map((r) => ({ ...r, data: JSON.parse(r.data) })),
      hasMore: rows.length > 50,
    });
  });
  app.post(base + "/:id/movements", (req, res) => {
    access(req, true, true);
    const input = movementInput.parse(req.body),
      v = { ...input, quantity: stockText(stockUnits(input.quantity)) },
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `stock:movement:${site}:${id}`,
      v,
      () => {
        const row = stockItem(db, site, id);
        expected(row, v.version);
        return append(
          req,
          row,
          v,
          v.kind,
          v.quantity,
          ["issue", "adjust_out"].includes(v.kind) ? -1 : 1,
          null,
        );
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.post(base + "/:id/movements/:movementId/reverse", (req, res) => {
    access(req, true, true);
    const v = reversalInput.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id),
      target = String(req.params.movementId);
    mutate(
      req,
      res,
      `stock:reverse:${site}:${id}:${target}`,
      v,
      () => {
        const row = stockItem(db, site, id);
        expected(row, v.version);
        const state = stockState(db, row),
          original = state.rows.find((r) => r.id === target);
        if (!original)
          throw new HttpError(404, "이 품목의 이동을 찾을 수 없습니다.");
        if (
          db
            .prepare(
              "SELECT id FROM ppe_issues WHERE issue_movement_id=? OR return_movement_id=?",
            )
            .get(target, target)
        )
          throw new HttpError(
            409,
            "보호구 지급과 연결된 이동입니다. 업체·보호구 원장의 전량 반납 또는 정정 메모를 사용하세요. 원장 밖에서 직접 역분개하지 않습니다.",
          );

        if(db.prepare("SELECT 1 FROM cost_stock_receipts WHERE movement_id=? OR reversal_movement_id=?").get(target,target)) throw new HttpError(409,"비용 출처 연결 이동입니다. 연결 입고 화면의 명시 전량 역분개를 사용하세요. 비용은 자동 취소하지 않습니다.");
        if(db.prepare("SELECT 1 FROM ppe_return_entries WHERE movement_id=?").get(target)) throw new HttpError(409,"전용 보호구 반납 원장에서만 정정합니다.");
        if(db.prepare("SELECT 1 FROM ppe_correction_links WHERE movement_id=?").get(target)) throw new HttpError(409,"보호구 정정 메모가 참조하는 조정입니다. 역분개하지 않습니다.");
        if (original.kind === "reversal" || state.reversed.has(target))
          throw new HttpError(
            409,
            "역분개 행 또는 이미 역분개한 원본은 다시 역분개할 수 없습니다. 부분 역분개는 지원하지 않습니다.",
          );
        return append(
          req,
          row,
          v,
          "reversal",
          original.quantity,
          original.direction === 1 ? -1 : 1,
          original.id,
        );
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.get(base + "/:id/print", (req, res) => {
    access(req, true, true);
    const item = stockItem(
        db,
        String(req.params.siteId),
        String(req.params.id),
      ),
      state = stockState(db, item);
    res
      .type("html")
      .send(printStock(item, state.rows, stockText(state.balance)));
  });
}
