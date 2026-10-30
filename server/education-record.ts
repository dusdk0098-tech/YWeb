import type { Db } from "./db.js";
import type {
  EducationRow,
  EducationParticipant,
  EducationSnapshot,
} from "./education.js";
import {
  scheduledMinutes,
  type EducationInput,
} from "./education-validation.js";
import { educationCatalogSource } from "./education-catalog-source.js";
export function fullEducationRecord(db: Db, row: EducationRow) {
  const body = JSON.parse(row.body) as EducationInput,
    snap = db
      .prepare("SELECT body,hash FROM education_snapshots WHERE session_id=?")
      .get(row.id) as { body: string; hash: string } | undefined;
  return {
    ...row,
    body,
    scheduledMinutes: scheduledMinutes(body),
    catalogSource: educationCatalogSource(db, row.id, body),
    participants: db
      .prepare(
        "SELECT worker_id,name,affiliation,kind,state,attended_minutes,recorded_by,recorded_at FROM education_participants WHERE session_id=? ORDER BY worker_id",
      )
      .all(row.id) as EducationParticipant[],
    snapshot: snap
      ? { body: JSON.parse(snap.body) as EducationSnapshot, hash: snap.hash }
      : null,
    successorId:
      (
        db
          .prepare("SELECT id FROM education_sessions WHERE parent_id=?")
          .get(row.id) as { id: string } | undefined
      )?.id || null,
  };
}
