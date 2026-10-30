import type { Db } from "./db.js";
export function migrateCompaniesPpe(db: Db) {
  db.exec(`
CREATE TABLE companies(id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),name TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN(0,1)),version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX companies_site ON companies(site_id,name,id);
CREATE TABLE company_events(id INTEGER PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id),version INTEGER NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,at TEXT NOT NULL,reason TEXT NOT NULL,snapshot TEXT NOT NULL,UNIQUE(company_id,version));
CREATE TABLE worker_companies(worker_id TEXT PRIMARY KEY REFERENCES workers(id),site_id TEXT NOT NULL REFERENCES sites(id),company_id TEXT REFERENCES companies(id),version INTEGER NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE worker_company_events(id INTEGER PRIMARY KEY,worker_id TEXT NOT NULL REFERENCES workers(id),site_id TEXT NOT NULL,version INTEGER NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,at TEXT NOT NULL,reason TEXT NOT NULL,snapshot TEXT NOT NULL,UNIQUE(worker_id,version));
CREATE TABLE ppe_issues(id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),worker_id TEXT NOT NULL REFERENCES workers(id),item_id TEXT NOT NULL REFERENCES stock_items(id),issue_movement_id TEXT UNIQUE NOT NULL REFERENCES stock_movements(id),return_movement_id TEXT UNIQUE REFERENCES stock_movements(id),original TEXT NOT NULL,original_hash TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('issued','returned')),version INTEGER NOT NULL,return_record TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX ppe_site ON ppe_issues(site_id,created_at,id);
CREATE TABLE ppe_events(id INTEGER PRIMARY KEY,issue_id TEXT NOT NULL REFERENCES ppe_issues(id),version INTEGER NOT NULL,event TEXT NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,at TEXT NOT NULL,reason TEXT NOT NULL,snapshot TEXT NOT NULL,UNIQUE(issue_id,version));
CREATE TABLE ppe_correction_links(movement_id TEXT PRIMARY KEY REFERENCES stock_movements(id),issue_id TEXT NOT NULL REFERENCES ppe_issues(id),snapshot TEXT NOT NULL);
CREATE TRIGGER company_no_delete BEFORE DELETE ON companies BEGIN SELECT RAISE(ABORT,'Company retained'); END;
CREATE TRIGGER company_origin BEFORE UPDATE ON companies WHEN NEW.id IS NOT OLD.id OR NEW.site_id IS NOT OLD.site_id OR NEW.created_at IS NOT OLD.created_at BEGIN SELECT RAISE(ABORT,'Company origin immutable'); END;
CREATE TRIGGER ppe_no_delete BEFORE DELETE ON ppe_issues BEGIN SELECT RAISE(ABORT,'PPE retained'); END;
CREATE TRIGGER ppe_original BEFORE UPDATE ON ppe_issues WHEN NEW.id IS NOT OLD.id OR NEW.site_id IS NOT OLD.site_id OR NEW.worker_id IS NOT OLD.worker_id OR NEW.item_id IS NOT OLD.item_id OR NEW.issue_movement_id IS NOT OLD.issue_movement_id OR NEW.original IS NOT OLD.original OR NEW.original_hash IS NOT OLD.original_hash OR (OLD.return_movement_id IS NOT NULL AND (NEW.return_movement_id IS NOT OLD.return_movement_id OR NEW.return_record IS NOT OLD.return_record OR NEW.status IS NOT OLD.status)) BEGIN SELECT RAISE(ABORT,'PPE source/return immutable'); END;
PRAGMA user_version=21;`);
  for (const table of [
    "company_events",
    "worker_company_events",
    "ppe_events",
    "ppe_correction_links",
  ])
    for (const action of ["UPDATE", "DELETE"])
      db.exec(
        `CREATE TRIGGER ${table}_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'History immutable'); END;`,
      );
}
