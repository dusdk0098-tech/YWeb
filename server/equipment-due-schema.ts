import type { Db } from "./db.js";
export function migrateEquipmentDue(db: Db) {
  db.exec(`CREATE TABLE equipment_due(equipment_id TEXT PRIMARY KEY REFERENCES equipment(id),body TEXT NOT NULL);
CREATE TRIGGER equipment_due_no_delete BEFORE DELETE ON equipment_due BEGIN SELECT RAISE(ABORT,'Due metadata cannot be deleted; use reasoned clear'); END;
PRAGMA user_version=15;`);
}
