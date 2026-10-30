import type { Db } from './db.js';
// Optional packet references need a reader capability fence; historical bytes are untouched.
export function migrateWorkPlanPackets(db:Db){db.exec('PRAGMA user_version=51;');}
