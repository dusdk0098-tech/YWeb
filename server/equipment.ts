import { equipmentEvent } from "./equipment-event.js";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import {
  equipmentInput,
  equipmentEdit,
  equipmentStatus,
  equipmentFilter,
  equipmentPage,
} from "./equipment-validation.js";
import {
  equipmentRecord,
  getEquipment,
  equipmentExpected,
  type EquipmentRow,
  type EquipmentEvent,
} from "./equipment-model.js";
import { printEquipment } from "./equipment-print.js";
export function registerEquipmentRoutes(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  const base = "/api/sites/:siteId/equipment";
  function code(site: string, value: string, except = "") {
    if (
      value &&
      db
        .prepare(
          "SELECT id FROM equipment WHERE site_id=? AND asset_code=? AND id!=?",
        )
        .get(site, value, except)
    )
      throw new HttpError(
        409,
        "이 현장에서 이미 사용하는 장비 코드입니다. 퇴역 장비의 코드도 재사용하지 않습니다.",
      );
  }
  app.get(base, (req, res) => {
    access(req);
    const q = equipmentFilter.parse(req.query),
      rows = db
        .prepare(
          "SELECT e.*,d.body AS due_metadata FROM equipment e LEFT JOIN equipment_due d ON d.equipment_id=e.id WHERE e.site_id=? AND (? IS NULL OR e.status=?) ORDER BY e.created_at DESC,e.id DESC LIMIT 51 OFFSET ?",
        )
        .all(
          String(req.params.siteId),
          q.status || null,
          q.status || null,
          q.offset,
        ) as EquipmentRow[];
    res.json({
      items: rows.slice(0, 50).map(equipmentRecord),
      hasMore: rows.length > 50,
    });
  });
  app.get(base + "/:id", (req, res) => {
    access(req);
    res.json(
      equipmentRecord(
        getEquipment(db, String(req.params.siteId), String(req.params.id)),
      ),
    );
  });
  app.get(base + "/:id/events", (req, res) => {
    access(req);
    const row = getEquipment(
        db,
        String(req.params.siteId),
        String(req.params.id),
      ),
      { offset } = equipmentPage.parse(req.query),
      rows = db
        .prepare(
          "SELECT * FROM equipment_events WHERE equipment_id=? ORDER BY version LIMIT 51 OFFSET ?",
        )
        .all(row.id, offset) as EquipmentEvent[];
    res.json({
      items: rows
        .slice(0, 50)
        .map((v) => ({ ...v, snapshot: JSON.parse(v.snapshot) })),
      hasMore: rows.length > 50,
    });
  });
  app.get(base + "/:id/print", (req, res) => {
    access(req);
    const row = getEquipment(
        db,
        String(req.params.siteId),
        String(req.params.id),
      ),
      events = db
        .prepare(
          "SELECT * FROM equipment_events WHERE equipment_id=? ORDER BY version LIMIT 1001",
        )
        .all(row.id) as EquipmentEvent[];
    if (events.length > 1000)
      throw new HttpError(
        400,
        "전체 이력이 1000건을 넘어 인쇄할 수 없습니다. 이력 페이지를 조회하세요.",
      );
    res.type("html").send(printEquipment(equipmentRecord(row), events, false));
  });
  app.post(base, (req, res) => {
    access(req, true, true);
    const v = equipmentInput.parse(req.body),
      site = String(req.params.siteId);
    mutate(
      req,
      res,
      `equipment:create:${site}`,
      v,
      () => {
        code(site, v.assetCode);
        const id = randomUUID(),
          now = new Date().toISOString();
        db.prepare("INSERT INTO equipment VALUES(?,?,?,?,'active',1,?,?)").run(
          id,
          site,
          v.assetCode,
          JSON.stringify(v),
          now,
          now,
        );
        equipmentEvent(db, req, id, "created", "장비 등록");
        return equipmentRecord(getEquipment(db, site, id));
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.put(base + "/:id", (req, res) => {
    access(req, true, true);
    const { version, reason, ...body } = equipmentEdit.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `equipment:edit:${site}:${id}`,
      { version, reason, ...body },
      () => {
        equipmentExpected(getEquipment(db, site, id), version);
        code(site, body.assetCode, id);
        db.prepare(
          "UPDATE equipment SET asset_code=?,body=?,version=version+1,updated_at=? WHERE id=?",
        ).run(
          body.assetCode,
          JSON.stringify(body),
          new Date().toISOString(),
          id,
        );
        equipmentEvent(db, req, id, "updated", reason);
        return equipmentRecord(getEquipment(db, site, id));
      },
      () => {
        access(req, true, true);
      },
    );
  });
  app.post(base + "/:id/status", (req, res) => {
    access(req, true, true);
    const v = equipmentStatus.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id);
    mutate(
      req,
      res,
      `equipment:status:${site}:${id}`,
      v,
      () => {
        const row = getEquipment(db, site, id);
        equipmentExpected(row, v.version);
        if (row.status === v.status)
          throw new HttpError(409, "이미 같은 장비 상태입니다.");
        db.prepare(
          "UPDATE equipment SET status=?,version=version+1,updated_at=? WHERE id=?",
        ).run(v.status, new Date().toISOString(), id);
        equipmentEvent(
          db,
          req,
          id,
          v.status === "retired" ? "retired" : "reactivated",
          v.reason,
        );
        return equipmentRecord(getEquipment(db, site, id));
      },
      () => {
        access(req, true, true);
      },
    );
  });
}
