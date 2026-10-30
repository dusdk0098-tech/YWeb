import type { Db } from "./db.js";
// Migration version is assigned at integration, after the preceding phase freezes.
export function createStockMinimumTables(db: Db) {
  db.exec(`
CREATE TABLE stock_minimum_events(
 id TEXT PRIMARY KEY,item_id TEXT NOT NULL REFERENCES stock_items(id),
 version INTEGER NOT NULL CHECK(version>0),snapshot TEXT NOT NULL,snapshot_hash TEXT NOT NULL,
 UNIQUE(item_id,version));
CREATE TRIGGER stock_minimum_sequence BEFORE INSERT ON stock_minimum_events
 WHEN NEW.version!=COALESCE((SELECT MAX(version)+1 FROM stock_minimum_events WHERE item_id=NEW.item_id),1)
 BEGIN SELECT RAISE(ABORT,'Minimum setting sequence mismatch'); END;
CREATE TRIGGER stock_minimum_no_update BEFORE UPDATE ON stock_minimum_events
 BEGIN SELECT RAISE(ABORT,'Minimum setting history immutable'); END;
CREATE TRIGGER stock_minimum_no_delete BEFORE DELETE ON stock_minimum_events
 BEGIN SELECT RAISE(ABORT,'Minimum setting history retained'); END;`);
}

export function migrateStockMinimums(db: Db) { createStockMinimumTables(db); db.exec("PRAGMA user_version=46"); }
