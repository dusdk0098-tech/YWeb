import type { Db } from "./db.js";
export function migrateStock(db: Db) {
  db.exec(`
CREATE TABLE stock_items(id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),name TEXT NOT NULL,unit TEXT NOT NULL,version INTEGER NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX stock_items_site ON stock_items(site_id,name,id);
CREATE TABLE stock_movements(id TEXT PRIMARY KEY,item_id TEXT NOT NULL REFERENCES stock_items(id),sequence INTEGER NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('opening','receipt','issue','adjust_in','adjust_out','reversal')),quantity TEXT NOT NULL,direction INTEGER NOT NULL CHECK(direction IN(-1,1)),effective_date TEXT NOT NULL,reason TEXT NOT NULL,reverses_id TEXT UNIQUE REFERENCES stock_movements(id),actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,recorded_at TEXT NOT NULL,item_snapshot TEXT NOT NULL,balance_after TEXT NOT NULL,hash TEXT NOT NULL,UNIQUE(item_id,sequence));
CREATE INDEX stock_movements_item ON stock_movements(item_id,sequence);
CREATE TABLE stock_events(id INTEGER PRIMARY KEY,item_id TEXT NOT NULL REFERENCES stock_items(id),version INTEGER NOT NULL,event TEXT NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,at TEXT NOT NULL,reason TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(item_id,version));
CREATE TRIGGER stock_item_origin BEFORE UPDATE ON stock_items WHEN NEW.id IS NOT OLD.id OR NEW.site_id IS NOT OLD.site_id OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at OR (NEW.unit IS NOT OLD.unit AND EXISTS(SELECT 1 FROM stock_movements WHERE item_id=OLD.id)) BEGIN SELECT RAISE(ABORT,'Stock origin/unit immutable after movement'); END;
CREATE TRIGGER stock_item_no_delete BEFORE DELETE ON stock_items BEGIN SELECT RAISE(ABORT,'Stock item cannot be deleted'); END;
CREATE TRIGGER stock_movement_insert BEFORE INSERT ON stock_movements WHEN NEW.sequence != COALESCE((SELECT MAX(sequence)+1 FROM stock_movements WHERE item_id=NEW.item_id),1) OR NEW.effective_date < COALESCE((SELECT MAX(effective_date) FROM stock_movements WHERE item_id=NEW.item_id),'') OR (NEW.kind='opening' AND NEW.sequence!=1) OR (NEW.kind='reversal' AND NOT EXISTS(SELECT 1 FROM stock_movements WHERE id=NEW.reverses_id AND item_id=NEW.item_id AND kind!='reversal' AND quantity=NEW.quantity AND direction=-NEW.direction)) OR (NEW.kind!='reversal' AND NEW.reverses_id IS NOT NULL) BEGIN SELECT RAISE(ABORT,'Stock chronology or reversal invalid'); END;
CREATE TRIGGER stock_movement_no_update BEFORE UPDATE ON stock_movements BEGIN SELECT RAISE(ABORT,'Stock movement immutable'); END;
CREATE TRIGGER stock_movement_no_delete BEFORE DELETE ON stock_movements BEGIN SELECT RAISE(ABORT,'Stock movement immutable'); END;
CREATE TRIGGER stock_event_no_update BEFORE UPDATE ON stock_events BEGIN SELECT RAISE(ABORT,'Stock event immutable'); END;
CREATE TRIGGER stock_event_no_delete BEFORE DELETE ON stock_events BEGIN SELECT RAISE(ABORT,'Stock event immutable'); END;
PRAGMA user_version=14;`);
}
