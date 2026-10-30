import type { Db } from "./db.js";
export function migrateEquipment(db: Db) {
  db.exec(`
CREATE TABLE equipment(id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),asset_code TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('active','retired')),version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX equipment_code ON equipment(site_id,asset_code) WHERE asset_code!='';
CREATE INDEX equipment_site ON equipment(site_id,status,id);
CREATE TABLE equipment_events(id INTEGER PRIMARY KEY,equipment_id TEXT NOT NULL REFERENCES equipment(id),version INTEGER NOT NULL,event TEXT NOT NULL,reason TEXT NOT NULL,actor_id TEXT NOT NULL,name TEXT NOT NULL,at TEXT NOT NULL,snapshot TEXT NOT NULL,UNIQUE(equipment_id,version));
CREATE TABLE equipment_uses(id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),equipment_id TEXT NOT NULL REFERENCES equipment(id),equipment_snapshot TEXT NOT NULL,owner_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('recorded','cancelled')),version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX equipment_uses_site ON equipment_uses(site_id,equipment_id,created_at,id);
CREATE TABLE equipment_use_events(id INTEGER PRIMARY KEY,use_id TEXT NOT NULL REFERENCES equipment_uses(id),version INTEGER NOT NULL,reason TEXT NOT NULL,actor_id TEXT NOT NULL,name TEXT NOT NULL,at TEXT NOT NULL,snapshot TEXT NOT NULL,UNIQUE(use_id,version));
CREATE TRIGGER equipment_event_no_update BEFORE UPDATE ON equipment_events BEGIN SELECT RAISE(ABORT,'Equipment history is immutable'); END;
CREATE TRIGGER equipment_event_no_delete BEFORE DELETE ON equipment_events BEGIN SELECT RAISE(ABORT,'Equipment history is immutable'); END;
CREATE TRIGGER equipment_use_event_no_update BEFORE UPDATE ON equipment_use_events BEGIN SELECT RAISE(ABORT,'Use history is immutable'); END;
CREATE TRIGGER equipment_use_event_no_delete BEFORE DELETE ON equipment_use_events BEGIN SELECT RAISE(ABORT,'Use history is immutable'); END;
CREATE TRIGGER equipment_no_delete BEFORE DELETE ON equipment BEGIN SELECT RAISE(ABORT,'Equipment cannot be deleted'); END;
CREATE TRIGGER equipment_use_no_delete BEFORE DELETE ON equipment_uses BEGIN SELECT RAISE(ABORT,'Use cannot be deleted'); END;
CREATE TRIGGER equipment_use_source_frozen BEFORE UPDATE ON equipment_uses WHEN NEW.equipment_id!=OLD.equipment_id OR NEW.equipment_snapshot!=OLD.equipment_snapshot OR NEW.site_id!=OLD.site_id OR NEW.owner_id!=OLD.owner_id BEGIN SELECT RAISE(ABORT,'Use source is immutable'); END;
CREATE TRIGGER equipment_use_site_check BEFORE INSERT ON equipment_uses WHEN NOT EXISTS(SELECT 1 FROM equipment WHERE id=NEW.equipment_id AND site_id=NEW.site_id) BEGIN SELECT RAISE(ABORT,'Equipment site mismatch'); END;
PRAGMA user_version=9;
`);
}
