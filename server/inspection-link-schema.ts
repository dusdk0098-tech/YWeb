import type { Db } from "./db.js";
export function migrateInspectionLinks(db: Db) {
  db.exec(`
 CREATE TABLE inspection_hazard_links (
   id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id), inspection_id TEXT NOT NULL REFERENCES inspections(id),
   item_id TEXT NOT NULL, hazard_id TEXT NOT NULL UNIQUE REFERENCES hazard_reports(id), snapshot TEXT NOT NULL,
   created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, UNIQUE(inspection_id,item_id));
 CREATE INDEX inspection_links_site ON inspection_hazard_links(site_id,inspection_id);
 CREATE TRIGGER inspection_link_no_update BEFORE UPDATE ON inspection_hazard_links BEGIN SELECT RAISE(ABORT,'Inspection provenance is immutable'); END;
 CREATE TRIGGER inspection_link_no_delete BEFORE DELETE ON inspection_hazard_links BEGIN SELECT RAISE(ABORT,'Inspection provenance is immutable'); END;
 CREATE TRIGGER inspection_link_site_check BEFORE INSERT ON inspection_hazard_links
 WHEN NOT EXISTS(SELECT 1 FROM inspections i JOIN hazard_reports h ON h.id=NEW.hazard_id WHERE i.id=NEW.inspection_id AND i.site_id=NEW.site_id AND h.site_id=NEW.site_id)
 BEGIN SELECT RAISE(ABORT,'Inspection link site mismatch'); END;
 PRAGMA user_version=6;
`);
}
