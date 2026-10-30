import type { Db } from "./db.js";
/** Format capability fence: older code cannot read three-level JSON safely.
 * No existing numeric body/snapshot is rewritten. */
export function migrateRiskMethods(db: Db) {
  db.exec("PRAGMA user_version=27");
}

/** Checklist format fence; preserve all prior document bytes. */
export function migrateRiskChecklist(db: Db) {
  db.exec("PRAGMA user_version=28");
}

/** Narrative document JSON capability fence, without rewriting prior data. */
export function migrateRiskNarrative(db: Db) {
  db.exec("PRAGMA user_version=30");
}
