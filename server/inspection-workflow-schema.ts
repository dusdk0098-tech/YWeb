import type {Db} from "./db.js";
export function createInspectionUseTables(db:Db){db.exec(`
CREATE TABLE inspection_template_use_stops(template_id TEXT PRIMARY KEY REFERENCES inspection_templates(id),site_id TEXT NOT NULL REFERENCES sites(id),source_version INTEGER NOT NULL,source_hash TEXT NOT NULL,snapshot TEXT NOT NULL,hash TEXT NOT NULL);
CREATE TRIGGER inspection_use_source BEFORE INSERT ON inspection_template_use_stops WHEN NOT EXISTS(SELECT 1 FROM inspection_templates WHERE id=NEW.template_id AND site_id=NEW.site_id AND version=NEW.source_version AND status='published') BEGIN SELECT RAISE(ABORT,'Published inspection source required'); END;
CREATE TRIGGER inspection_use_no_update BEFORE UPDATE ON inspection_template_use_stops BEGIN SELECT RAISE(ABORT,'Use stop immutable'); END;
CREATE TRIGGER inspection_use_no_delete BEFORE DELETE ON inspection_template_use_stops BEGIN SELECT RAISE(ABORT,'Use stop immutable'); END;
`);}

export function migrateInspectionWorkflow(db:Db){createInspectionUseTables(db);db.exec("PRAGMA user_version=40");}
