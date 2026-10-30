import type { Db } from './db.js';
// Capability fence only: no old plan, snapshot, receipt, event or attachment rewrite.
export function migrateWorkPlanForms(db:Db){db.exec('PRAGMA user_version=50;');}
