import type { Db } from './db.js';
// Optional daily fixed inspection references reader fence only.
export function migrateDailyInspectionReferences(db:Db){db.exec('PRAGMA user_version=56;');}
