import type { Db } from "./db.js";
export function migrateEducationCatalog(db: Db) {
  db.exec(`
CREATE TABLE education_catalog(id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),parent_id TEXT UNIQUE REFERENCES education_catalog(id),body TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN('draft','published')),version INTEGER NOT NULL,published_snapshot TEXT,published_hash TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE education_catalog_revision_notes(catalog_id TEXT PRIMARY KEY REFERENCES education_catalog(id),reason TEXT NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,at TEXT NOT NULL);
CREATE TRIGGER education_catalog_note_no_update BEFORE UPDATE ON education_catalog_revision_notes BEGIN SELECT RAISE(ABORT,'Catalog revision note immutable'); END;
CREATE TRIGGER education_catalog_note_no_delete BEFORE DELETE ON education_catalog_revision_notes BEGIN SELECT RAISE(ABORT,'Catalog revision note immutable'); END;
CREATE INDEX education_catalog_site ON education_catalog(site_id,created_at,id);
CREATE TABLE education_catalog_links(session_id TEXT PRIMARY KEY REFERENCES education_sessions(id),catalog_id TEXT NOT NULL REFERENCES education_catalog(id),source_snapshot TEXT NOT NULL,source_hash TEXT NOT NULL);
CREATE TRIGGER education_catalog_frozen BEFORE UPDATE ON education_catalog WHEN OLD.status='published' OR NEW.id IS NOT OLD.id OR NEW.site_id IS NOT OLD.site_id OR NEW.parent_id IS NOT OLD.parent_id OR NEW.created_at IS NOT OLD.created_at BEGIN SELECT RAISE(ABORT,'Published catalog/origin immutable'); END;
CREATE TRIGGER education_catalog_parent BEFORE INSERT ON education_catalog WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM education_catalog WHERE id=NEW.parent_id AND site_id=NEW.site_id AND status='published') BEGIN SELECT RAISE(ABORT,'Catalog parent must be published in site'); END;
CREATE TRIGGER education_catalog_no_delete BEFORE DELETE ON education_catalog BEGIN SELECT RAISE(ABORT,'Catalog cannot be deleted'); END;
CREATE TRIGGER education_catalog_link_scope BEFORE INSERT ON education_catalog_links WHEN NOT EXISTS(SELECT 1 FROM education_catalog c JOIN education_sessions s ON s.site_id=c.site_id WHERE c.id=NEW.catalog_id AND c.status='published' AND s.id=NEW.session_id AND json_extract(NEW.source_snapshot,'$.id')=c.id AND json_extract(NEW.source_snapshot,'$.site.id')=c.site_id) BEGIN SELECT RAISE(ABORT,'Catalog source must match same-site published version'); END;
CREATE TRIGGER education_catalog_link_no_update BEFORE UPDATE ON education_catalog_links BEGIN SELECT RAISE(ABORT,'Education catalog provenance immutable'); END;
CREATE TRIGGER education_catalog_link_no_delete BEFORE DELETE ON education_catalog_links BEGIN SELECT RAISE(ABORT,'Education catalog provenance immutable'); END;
PRAGMA user_version=18;`);
}
