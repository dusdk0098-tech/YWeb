import { hazardAttachments } from "./hazard-attachment-model.js";
import { randomUUID } from "node:crypto";
import { audit, type Db } from "./db.js";
import {
  hazardRecord,
  type HazardRow,
  type HazardStatus,
} from "./hazard-model.js";
import type { HazardInput } from "./hazard-validation.js";
// Caller owns the existing transaction. Report row, initial event and source link commit together.
export function createHazardDraft(
  db: Db,
  site: string,
  actorId: string,
  input: HazardInput,
  note = "신고 초안 생성",
) {
  const id = randomUUID(),
    now = new Date().toISOString();
  db.prepare(
    "INSERT INTO hazard_reports(id,site_id,owner_id,body,status,created_at,updated_at) VALUES(?,?,?,?,'draft',?,?)",
  ).run(id, site, actorId, JSON.stringify(input), now, now);
  const row = db
    .prepare("SELECT * FROM hazard_reports WHERE id=? AND site_id=?")
    .get(id, site) as HazardRow;
  recordHazardEvent(db, actorId, row, "created", null, note);
  return row;
}
export function recordHazardEvent(
  db: Db,
  actorId: string,
  row: HazardRow,
  type: string,
  from: HazardStatus | null,
  note: string,
) {
  const actor = db
    .prepare("SELECT name FROM users WHERE id=?")
    .get(actorId) as { name: string };
  db.prepare(
    "INSERT INTO hazard_events(report_id,version,event,from_status,to_status,note,actor_id,actor_name,at,snapshot) VALUES(?,?,?,?,?,?,?,?,?,?)",
  ).run(
    row.id,
    row.version,
    type,
    from,
    row.status,
    note,
    actorId,
    actor.name,
    row.updated_at,
    JSON.stringify({
      ...hazardRecord(row),
      attachments: hazardAttachments(db, row.id),
    }),
  );
  audit(db, actorId, row.site_id, "hazard." + type, row.id);
}
