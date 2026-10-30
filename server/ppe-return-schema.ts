import type { Db } from "./db.js";
// Integration assigns schema version after the preceding checkpoint freezes.
export function createPpeReturnTables(db:Db){db.exec(`
CREATE TABLE ppe_return_entries(
 id TEXT PRIMARY KEY, issue_id TEXT NOT NULL REFERENCES ppe_issues(id),
 item_id TEXT NOT NULL REFERENCES stock_items(id),
 movement_id TEXT UNIQUE NOT NULL REFERENCES stock_movements(id),
 kind TEXT NOT NULL CHECK(kind IN('partial','cancel','terminal')),
 cancels_id TEXT UNIQUE REFERENCES ppe_return_entries(id),
 snapshot TEXT NOT NULL,snapshot_hash TEXT NOT NULL,
 CHECK((kind='cancel' AND cancels_id IS NOT NULL) OR (kind!='cancel' AND cancels_id IS NULL)));
CREATE INDEX ppe_return_issue ON ppe_return_entries(issue_id);
CREATE INDEX ppe_return_item ON ppe_return_entries(item_id);
CREATE UNIQUE INDEX ppe_return_terminal ON ppe_return_entries(issue_id) WHERE kind='terminal';
CREATE TRIGGER ppe_return_insert BEFORE INSERT ON ppe_return_entries WHEN
 NOT EXISTS(SELECT 1 FROM ppe_issues p JOIN stock_movements m ON m.id=NEW.movement_id WHERE p.id=NEW.issue_id AND p.item_id=NEW.item_id AND m.item_id=NEW.item_id AND p.return_movement_id IS NULL)
 OR EXISTS(SELECT 1 FROM ppe_return_entries WHERE issue_id=NEW.issue_id AND kind='terminal')
 OR (NEW.kind='partial' AND (SELECT COUNT(*) FROM ppe_return_entries WHERE issue_id=NEW.issue_id AND kind='partial')>=3)
 OR (NEW.kind='cancel' AND NOT EXISTS(SELECT 1 FROM ppe_return_entries r JOIN stock_movements m ON m.id=NEW.movement_id WHERE r.id=NEW.cancels_id AND r.issue_id=NEW.issue_id AND r.kind='partial' AND m.kind='reversal' AND m.reverses_id=r.movement_id))
 OR (NEW.kind!='cancel' AND NOT EXISTS(SELECT 1 FROM stock_movements WHERE id=NEW.movement_id AND kind='adjust_in' AND direction=1 AND reverses_id IS NULL))
 BEGIN SELECT RAISE(ABORT,'PPE return source or capacity invalid'); END;
CREATE TRIGGER ppe_return_terminal_state BEFORE UPDATE ON ppe_issues WHEN
 EXISTS(SELECT 1 FROM ppe_return_entries WHERE issue_id=OLD.id) AND
 (NEW.return_movement_id IS NOT NULL OR (OLD.status='returned' AND NEW.status!='returned'))
 BEGIN SELECT RAISE(ABORT,'PPE partial history cannot become legacy or reopen terminal'); END;
CREATE TRIGGER ppe_return_no_update BEFORE UPDATE ON ppe_return_entries BEGIN SELECT RAISE(ABORT,'PPE return immutable'); END;
CREATE TRIGGER ppe_return_no_delete BEFORE DELETE ON ppe_return_entries BEGIN SELECT RAISE(ABORT,'PPE return immutable'); END;
`);}

export function migratePpeReturns(db:Db){createPpeReturnTables(db);db.exec("PRAGMA user_version=37");}
