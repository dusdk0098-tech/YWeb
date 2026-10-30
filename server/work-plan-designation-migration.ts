import type { Db } from './db.js';
// Reader capability only; no historical row rewrite.
export function migrateWorkPlanDesignations(db:Db){db.exec('PRAGMA user_version=52;');}
