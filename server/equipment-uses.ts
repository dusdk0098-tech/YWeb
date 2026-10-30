import type { Express, Request } from "express";
import { randomUUID } from "node:crypto";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import {
  equipmentUseCreate,
  equipmentUseEdit,
  equipmentUseFilter,
  equipmentPage,
} from "./equipment-validation.js";
import {
  equipmentRecord,
  equipmentUseRecord,
  getEquipment,
  getEquipmentUse,
  equipmentExpected,
  type EquipmentUseRow,
  type EquipmentEvent,
} from "./equipment-model.js";
import { printEquipment } from "./equipment-print.js";
export function registerEquipmentUseRoutes(
  app: Express,
  db: Db,
  { access, mutate }: SiteOperations,
) {
  const base = "/api/sites/:siteId/equipment-uses";
  function active(site: string, id: string) {
    const row = getEquipment(db, site, id);
    if (row.status !== "active")
      throw new HttpError(
        409,
        "퇴역 장비는 새 사용 또는 취소 복원 기록을 만들 수 없습니다. 기존 기록 정정/취소는 가능하며 복원은 관리자 재활성화 후 시도하세요.",
      );
    return row;
  }
  function owner(req: Request, row: EquipmentUseRow, role: string) {
    if (role !== "manager" && row.owner_id !== req.session.userId)
      throw new HttpError(
        403,
        "작성자 또는 현장 관리자만 사용기록을 정정/취소할 수 있습니다.",
      );
  }
  function event(req: Request, id: string, reason: string) {
    const row = getEquipmentUse(db, String(req.params.siteId), id),
      actor = db
        .prepare("SELECT name FROM users WHERE id=?")
        .get(req.session.userId!) as { name: string };
    db.prepare(
      "INSERT INTO equipment_use_events(use_id,version,reason,actor_id,name,at,snapshot) VALUES(?,?,?,?,?,?,?)",
    ).run(
      id,
      row.version,
      reason,
      req.session.userId!,
      actor.name,
      row.updated_at,
      JSON.stringify(equipmentUseRecord(row)),
    );
    audit(db, req.session.userId!, row.site_id, "equipment.use_recorded", id);
  }
  app.get(base, (req, res) => {
    access(req);
    const q = equipmentUseFilter.parse(req.query),
      site = String(req.params.siteId);
    if (q.equipmentId) getEquipment(db, site, q.equipmentId);
    const rows = db
      .prepare(
        "SELECT * FROM equipment_uses WHERE site_id=? AND (? IS NULL OR equipment_id=?) AND (? IS NULL OR json_extract(body,'$.date')=?) ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET ?",
      )
      .all(
        site,
        q.equipmentId || null,
        q.equipmentId || null,
        q.date || null,
        q.date || null,
        q.offset,
      ) as EquipmentUseRow[];
    res.json({
      items: rows.slice(0, 50).map(equipmentUseRecord),
      hasMore: rows.length > 50,
    });
  });
  app.get(base + "/:id", (req, res) => {
    access(req);
    res.json(
      equipmentUseRecord(
        getEquipmentUse(db, String(req.params.siteId), String(req.params.id)),
      ),
    );
  });
  app.get(base + "/:id/events", (req, res) => {
    access(req);
    const row = getEquipmentUse(
        db,
        String(req.params.siteId),
        String(req.params.id),
      ),
      { offset } = equipmentPage.parse(req.query),
      rows = db
        .prepare(
          "SELECT * FROM equipment_use_events WHERE use_id=? ORDER BY version LIMIT 51 OFFSET ?",
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
    const row = getEquipmentUse(
        db,
        String(req.params.siteId),
        String(req.params.id),
      ),
      events = db
        .prepare(
          "SELECT * FROM equipment_use_events WHERE use_id=? ORDER BY version LIMIT 1001",
        )
        .all(row.id) as EquipmentEvent[];
    if (events.length > 1000)
      throw new HttpError(
        400,
        "전체 이력이 1000건을 넘어 인쇄할 수 없습니다. 이력 페이지를 조회하세요.",
      );
    res
      .type("html")
      .send(printEquipment(equipmentUseRecord(row), events, true));
  });
  app.post(base, (req, res) => {
    access(req, true);
    const v = equipmentUseCreate.parse(req.body),
      site = String(req.params.siteId);
    active(site, v.equipmentId);
    mutate(
      req,
      res,
      `equipment:use:create:${site}`,
      v,
      () => {
        const source = active(site, v.equipmentId),
          id = randomUUID(),
          now = new Date().toISOString();
        db.prepare(
          "INSERT INTO equipment_uses VALUES(?,?,?,?,?,?,'recorded',1,?,?)",
        ).run(
          id,
          site,
          v.equipmentId,
          JSON.stringify(equipmentRecord(source)),
          req.session.userId!,
          JSON.stringify(v.body),
          now,
          now,
        );
        event(req, id, "수기 사용기록 생성");
        return equipmentUseRecord(getEquipmentUse(db, site, id));
      },
      () => {
        access(req, true);
        active(site, v.equipmentId);
      },
    );
  });
  app.put(base + "/:id", (req, res) => {
    const role = access(req, true),
      v = equipmentUseEdit.parse(req.body),
      site = String(req.params.siteId),
      id = String(req.params.id),
      old = getEquipmentUse(db, site, id);
    owner(req, old, role);
    if (old.status === "cancelled" && v.status === "recorded")
      active(site, old.equipment_id);
    mutate(
      req,
      res,
      `equipment:use:edit:${site}:${id}`,
      v,
      () => {
        const row = getEquipmentUse(db, site, id);
        equipmentExpected(row, v.version);
        owner(req, row, access(req, true));
        if (row.status === "cancelled" && v.status === "recorded")
          active(site, row.equipment_id);
        db.prepare(
          "UPDATE equipment_uses SET body=?,status=?,version=version+1,updated_at=? WHERE id=?",
        ).run(JSON.stringify(v.body), v.status, new Date().toISOString(), id);
        event(req, id, v.reason);
        return equipmentUseRecord(getEquipmentUse(db, site, id));
      },
      () => {
        const currentRole = access(req, true);
        const current = getEquipmentUse(db, site, id);
        owner(req, current, currentRole);
        if (current.status === "cancelled" && v.status === "recorded")
          active(site, current.equipment_id);
      },
    );
  });
}
