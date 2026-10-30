import type { EquipmentDueBody } from "./equipment-due.js";
import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import type {
  EquipmentInput,
  EquipmentUseBody,
} from "./equipment-validation.js";
export type EquipmentRow = {
  due_metadata?: string | null;
  id: string;
  site_id: string;
  asset_code: string;
  body: string;
  status: "active" | "retired";
  version: number;
  created_at: string;
  updated_at: string;
};
export type EquipmentUseRow = {
  id: string;
  site_id: string;
  equipment_id: string;
  equipment_snapshot: string;
  owner_id: string;
  body: string;
  status: "recorded" | "cancelled";
  version: number;
  created_at: string;
  updated_at: string;
};
export const equipmentRecord = (r: EquipmentRow) => {
  const { due_metadata, ...record } = r;
  return {
    ...record,
    body: JSON.parse(r.body) as EquipmentInput,
    dueMetadata: due_metadata
      ? (JSON.parse(due_metadata) as EquipmentDueBody)
      : null,
  };
};
export type EquipmentRecord = ReturnType<typeof equipmentRecord>;
export const equipmentUseRecord = (r: EquipmentUseRow) => ({
  ...r,
  body: JSON.parse(r.body) as EquipmentUseBody,
  equipment_snapshot: JSON.parse(r.equipment_snapshot) as EquipmentRecord,
});
export type EquipmentUseRecord = ReturnType<typeof equipmentUseRecord>;
export function getEquipment(db: Db, site: string, id: string) {
  const r = db
    .prepare(
      "SELECT e.*,d.body AS due_metadata FROM equipment e LEFT JOIN equipment_due d ON d.equipment_id=e.id WHERE e.site_id=? AND e.id=?",
    )
    .get(site, id) as EquipmentRow | undefined;
  if (!r) throw new HttpError(404, "장비를 찾을 수 없습니다.");
  return r;
}
export function getEquipmentUse(db: Db, site: string, id: string) {
  const r = db
    .prepare("SELECT * FROM equipment_uses WHERE site_id=? AND id=?")
    .get(site, id) as EquipmentUseRow | undefined;
  if (!r) throw new HttpError(404, "장비 사용기록을 찾을 수 없습니다.");
  return r;
}
export function equipmentExpected(row: { version: number }, v: number) {
  if (row.version !== v)
    throw new HttpError(
      409,
      "다른 요청이 먼저 저장되었습니다. 최신본을 다시 여세요.",
    );
}
export type EquipmentEvent = {
  id: number;
  version: number;
  event?: string;
  reason: string;
  actor_id: string;
  name: string;
  at: string;
  snapshot: string;
};
