import type { Request } from "express";
import { audit, type Db } from "./db.js";
import { getEquipment, equipmentRecord } from "./equipment-model.js";
export function equipmentEvent(
  db: Db,
  req: Request,
  id: string,
  kind: string,
  reason: string,
) {
  const row = getEquipment(db, String(req.params.siteId), id),
    actor = db
      .prepare("SELECT name FROM users WHERE id=?")
      .get(req.session.userId!) as { name: string };
  db.prepare(
    "INSERT INTO equipment_events(equipment_id,version,event,reason,actor_id,name,at,snapshot) VALUES(?,?,?,?,?,?,?,?)",
  ).run(
    id,
    row.version,
    kind,
    reason,
    req.session.userId!,
    actor.name,
    row.updated_at,
    JSON.stringify(equipmentRecord(row)),
  );
  audit(db, req.session.userId!, row.site_id, "equipment." + kind, id);
}
