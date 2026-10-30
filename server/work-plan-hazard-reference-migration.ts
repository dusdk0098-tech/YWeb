import type { Db } from './db.js';
// Reader capability only; no old content rewrite.
export function migrateWorkPlanHazardReferences(db:Db){db.exec('PRAGMA user_version=55;');}
