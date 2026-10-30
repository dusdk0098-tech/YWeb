import type { Db } from './db.js';
// Reader capability only; historical rows are unchanged.
export function migrateWorkPlanPlateReports(db:Db){db.exec('PRAGMA user_version=53;');}
