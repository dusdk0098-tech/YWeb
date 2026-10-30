import type { Db } from "./db.js";
// Assigned a migration number only after the preceding release freezes.
export function createCostEvidenceTables(db: Db) {
  db.exec(`
CREATE TABLE cost_evidence_files(
 id TEXT PRIMARY KEY,site_id TEXT NOT NULL REFERENCES sites(id),period_id TEXT NOT NULL REFERENCES cost_periods(id),
 filename TEXT NOT NULL,format TEXT NOT NULL CHECK(format IN ('image/png','image/jpeg','application/pdf')),
 size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 5242880),sha256 TEXT NOT NULL,bytes BLOB NOT NULL CHECK(length(bytes)=size),
 uploaded_by TEXT NOT NULL REFERENCES users(id),uploaded_at TEXT NOT NULL);
CREATE INDEX cost_evidence_files_period ON cost_evidence_files(period_id,uploaded_at,id);
CREATE INDEX cost_evidence_files_site ON cost_evidence_files(site_id);
CREATE TRIGGER cost_evidence_file_open BEFORE INSERT ON cost_evidence_files WHEN NOT EXISTS(
 SELECT 1 FROM cost_periods WHERE id=NEW.period_id AND site_id=NEW.site_id AND status='open')
 BEGIN SELECT RAISE(ABORT,'Evidence requires same-site open period'); END;
CREATE TRIGGER cost_evidence_file_fixed BEFORE UPDATE ON cost_evidence_files BEGIN SELECT RAISE(ABORT,'Evidence original immutable'); END;
CREATE TRIGGER cost_evidence_file_retained BEFORE DELETE ON cost_evidence_files BEGIN SELECT RAISE(ABORT,'Evidence original retained'); END;
CREATE TABLE cost_evidence_links(
 attachment_id TEXT NOT NULL REFERENCES cost_evidence_files(id),expense_id TEXT NOT NULL REFERENCES cost_expenses(id),
 period_id TEXT NOT NULL REFERENCES cost_periods(id),active INTEGER NOT NULL CHECK(active IN(0,1)),source TEXT NOT NULL,source_hash TEXT NOT NULL,
 PRIMARY KEY(attachment_id,expense_id));
CREATE INDEX cost_evidence_links_period ON cost_evidence_links(period_id,active,attachment_id,expense_id);
CREATE TRIGGER cost_evidence_link_insert BEFORE INSERT ON cost_evidence_links WHEN NOT EXISTS(
 SELECT 1 FROM cost_evidence_files f JOIN cost_expenses e ON e.period_id=f.period_id JOIN cost_periods p ON p.id=f.period_id
 WHERE f.id=NEW.attachment_id AND e.id=NEW.expense_id AND p.id=NEW.period_id AND p.status='open')
 BEGIN SELECT RAISE(ABORT,'Evidence link same open period required'); END;
CREATE TRIGGER cost_evidence_link_update BEFORE UPDATE ON cost_evidence_links WHEN
 NEW.attachment_id IS NOT OLD.attachment_id OR NEW.expense_id IS NOT OLD.expense_id OR NEW.period_id IS NOT OLD.period_id OR
 NOT EXISTS(SELECT 1 FROM cost_periods WHERE id=OLD.period_id AND status='open')
 BEGIN SELECT RAISE(ABORT,'Evidence link origin/open period required'); END;
CREATE TRIGGER cost_evidence_link_retained BEFORE DELETE ON cost_evidence_links BEGIN SELECT RAISE(ABORT,'Evidence link retained'); END;
CREATE TABLE cost_evidence_events(
 id INTEGER PRIMARY KEY,period_id TEXT NOT NULL REFERENCES cost_periods(id),version INTEGER NOT NULL,
 event TEXT NOT NULL,attachment_id TEXT NOT NULL REFERENCES cost_evidence_files(id),actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,
 at TEXT NOT NULL,reason TEXT NOT NULL,data TEXT NOT NULL,hash TEXT NOT NULL,UNIQUE(period_id,version));
CREATE TRIGGER cost_evidence_event_insert BEFORE INSERT ON cost_evidence_events WHEN
 NEW.version!=COALESCE((SELECT MAX(version)+1 FROM cost_evidence_events WHERE period_id=NEW.period_id),1) OR
 NOT EXISTS(SELECT 1 FROM cost_evidence_files WHERE id=NEW.attachment_id AND period_id=NEW.period_id)
 BEGIN SELECT RAISE(ABORT,'Evidence event sequence/source mismatch'); END;
CREATE TRIGGER cost_evidence_event_fixed BEFORE UPDATE ON cost_evidence_events BEGIN SELECT RAISE(ABORT,'Evidence event immutable'); END;
CREATE TRIGGER cost_evidence_event_retained BEFORE DELETE ON cost_evidence_events BEGIN SELECT RAISE(ABORT,'Evidence event retained'); END;
CREATE TABLE cost_close_evidence(
 closure_id TEXT PRIMARY KEY REFERENCES cost_closures(id),period_id TEXT NOT NULL REFERENCES cost_periods(id),closure_hash TEXT NOT NULL,
 snapshot TEXT NOT NULL,hash TEXT NOT NULL);
CREATE TRIGGER cost_close_evidence_source BEFORE INSERT ON cost_close_evidence WHEN NOT EXISTS(
 SELECT 1 FROM cost_closures WHERE id=NEW.closure_id AND period_id=NEW.period_id AND hash=NEW.closure_hash)
 BEGIN SELECT RAISE(ABORT,'Evidence requires exact fixed closure'); END;
CREATE TRIGGER cost_close_evidence_fixed BEFORE UPDATE ON cost_close_evidence BEGIN SELECT RAISE(ABORT,'Closure evidence immutable'); END;
CREATE TRIGGER cost_close_evidence_retained BEFORE DELETE ON cost_close_evidence BEGIN SELECT RAISE(ABORT,'Closure evidence retained'); END;
`);
}

export function migrateCostEvidence(db: Db) { createCostEvidenceTables(db); db.exec("PRAGMA user_version=48"); }
