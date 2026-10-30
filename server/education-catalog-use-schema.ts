import type {Db} from "./db.js";
// Migration version assigned only after preceding checkpoint is frozen.
export function createCatalogUseTables(db:Db){db.exec(`
CREATE TABLE education_catalog_use_stops(catalog_id TEXT PRIMARY KEY REFERENCES education_catalog(id),site_id TEXT NOT NULL REFERENCES sites(id),source_version INTEGER NOT NULL,source_hash TEXT NOT NULL,snapshot TEXT NOT NULL,snapshot_hash TEXT NOT NULL);
CREATE INDEX education_catalog_stops_site ON education_catalog_use_stops(site_id,catalog_id);
CREATE TRIGGER education_catalog_stop_source BEFORE INSERT ON education_catalog_use_stops WHEN NOT EXISTS(SELECT 1 FROM education_catalog WHERE id=NEW.catalog_id AND site_id=NEW.site_id AND status='published' AND version=NEW.source_version AND published_hash=NEW.source_hash) BEGIN SELECT RAISE(ABORT,'Use stop requires exact published source'); END;
CREATE TRIGGER education_catalog_stop_no_update BEFORE UPDATE ON education_catalog_use_stops BEGIN SELECT RAISE(ABORT,'Catalog use stop immutable'); END;
CREATE TRIGGER education_catalog_stop_no_delete BEFORE DELETE ON education_catalog_use_stops BEGIN SELECT RAISE(ABORT,'Catalog use stop immutable'); END;
`);}

export function migrateCatalogUse(db:Db){createCatalogUseTables(db);db.exec("PRAGMA user_version=39");}
