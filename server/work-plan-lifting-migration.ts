import type { Db } from './db.js';
// Reader capability only; historical rows remain unchanged.
export function migrateWorkPlanLifting(db:Db){db.exec('PRAGMA user_version=54;');}
