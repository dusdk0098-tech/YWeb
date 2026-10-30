import type { Db } from "./db.js";
// Additive records; existing monthly views and journal snapshots stay unchanged.
export function migrateDailyMonthlyRecords(db: Db) {
  db.exec(`
    PRAGMA user_version=44;
    CREATE TABLE daily_monthly_records (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id),
      month TEXT NOT NULL,
      number INTEGER NOT NULL CHECK(number BETWEEN 1 AND 1000),
      parent_id TEXT UNIQUE REFERENCES daily_monthly_records(id),
      body TEXT NOT NULL,
      hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(site_id,month,number)
    );
    CREATE INDEX daily_monthly_records_site_month ON daily_monthly_records(site_id,month,number);
    CREATE TRIGGER daily_monthly_records_scope BEFORE INSERT ON daily_monthly_records WHEN
      (NEW.number=1 AND NEW.parent_id IS NOT NULL) OR
      (NEW.number>1 AND NOT EXISTS(SELECT 1 FROM daily_monthly_records p WHERE p.id=NEW.parent_id AND p.site_id=NEW.site_id AND p.month=NEW.month AND p.number=NEW.number-1))
      BEGIN SELECT RAISE(ABORT,'Monthly record predecessor mismatch'); END;
    CREATE TRIGGER daily_monthly_records_fixed BEFORE UPDATE ON daily_monthly_records
      BEGIN SELECT RAISE(ABORT,'Monthly record immutable'); END;
    CREATE TRIGGER daily_monthly_records_retained BEFORE DELETE ON daily_monthly_records
      BEGIN SELECT RAISE(ABORT,'Monthly record retained'); END;
  `);
}
