// Local opt-in helpers. Importing this module never runs the separate CLI.
// Trusted operator-owned filesystem; not a sandbox against concurrent path swapping.
import { DatabaseSync, backup } from "node:sqlite";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  chmod,
  copyFile,
  readFile,
  writeFile,
  rm,
  stat,
  open,
} from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { z } from "zod";
import { RECOVERY_MARKER } from "../server/recovery-gate.js";
const DB_FILE = "database.sqlite",
  MANIFEST = "manifest.json";
import { CURRENT_SCHEMA_VERSION } from "../server/schema-version.js";
export const BACKUP_SCHEMA_VERSION = CURRENT_SCHEMA_VERSION;
// Schema16 added account_auth, which restore must advance. Older restored files are migrated by the app on start.
const MIN_BACKUP_SCHEMA_VERSION = 16;
const countTables = [
  "users",
  "sites",
  "memberships",
  "hazard_attachments",
  "education_attachments",
  "education_attachment_events",
  "education_archive_attachments",
  "work_plan_attachments",
  "work_plan_attachment_events",
  "minutes_attachments",
  "minutes_attachment_events",
  "daily_monthly_records",
  "cost_closures",
  "work_plan_document_reviews",
  "work_plan_review_events",
  "minutes",
  "minutes_records",
  "minutes_snapshots",
  "minutes_followups",
  "minutes_followup_events",
  "tbm_sessions",
  "tbm_risk_references",
  "companies",
  "worker_companies",
  "ppe_issues",
  "ppe_events",
  "ppe_return_entries",
  "stock_minimum_events",
  "cost_evidence_files",
  "cost_evidence_links",
  "cost_evidence_events",
  "cost_close_evidence",
  "cost_input_presets",
  "cost_expense_preset_sources",
  "education_catalog_use_stops",
  "inspection_template_use_stops",
  "cost_stock_receipts",
  "cost_baselines",
  "cost_baseline_statements",
  "risk_criteria",
  "risk_assessments",
  "risk_reuse_sources",
  "risk_actions",
  "risk_action_events",
  "risk_residuals",
  "risk_opinions",
  "risk_opinion_events",
  "risk_publications",
  "risk_publication_targets",
  "risk_publication_acks",
  "risk_publication_events",
] as const;
const countsSchema = z
  .object({
    users: z.number().int().nonnegative(),
    sites: z.number().int().nonnegative(),
    memberships: z.number().int().nonnegative(),
    hazard_attachments: z.number().int().nonnegative(),
    education_attachments: z.number().int().nonnegative(),
    education_attachment_events: z.number().int().nonnegative(),
    education_archive_attachments: z.number().int().nonnegative(),
    work_plan_attachments: z.number().int().nonnegative(),
    work_plan_attachment_events: z.number().int().nonnegative(),
    minutes_attachments: z.number().int().nonnegative(),
    minutes_attachment_events: z.number().int().nonnegative(),
    daily_monthly_records: z.number().int().nonnegative(),
    cost_closures: z.number().int().nonnegative(),
    work_plan_document_reviews: z.number().int().nonnegative(),
    work_plan_review_events: z.number().int().nonnegative(),
    minutes: z.number().int().nonnegative(),
    minutes_records: z.number().int().nonnegative(),
    minutes_snapshots: z.number().int().nonnegative(),
    minutes_followups: z.number().int().nonnegative(),
    minutes_followup_events: z.number().int().nonnegative(),
    tbm_sessions: z.number().int().nonnegative(),
    tbm_risk_references: z.number().int().nonnegative(),
    companies: z.number().int().nonnegative(),
    worker_companies: z.number().int().nonnegative(),
    ppe_issues: z.number().int().nonnegative(),
    ppe_events: z.number().int().nonnegative(),
    ppe_return_entries: z.number().int().nonnegative(),
    stock_minimum_events: z.number().int().nonnegative(),
    cost_evidence_files: z.number().int().nonnegative(),
    cost_evidence_links: z.number().int().nonnegative(),
    cost_evidence_events: z.number().int().nonnegative(),
    cost_close_evidence: z.number().int().nonnegative(),
    cost_input_presets: z.number().int().nonnegative(),
    cost_expense_preset_sources: z.number().int().nonnegative(),
    education_catalog_use_stops: z.number().int().nonnegative(),
    inspection_template_use_stops: z.number().int().nonnegative(),
    cost_stock_receipts: z.number().int().nonnegative(),
    cost_baselines: z.number().int().nonnegative(),
    cost_baseline_statements: z.number().int().nonnegative(),
    risk_criteria: z.number().int().nonnegative(),
    risk_assessments: z.number().int().nonnegative(),
    risk_reuse_sources: z.number().int().nonnegative(),
    risk_actions: z.number().int().nonnegative(),
    risk_action_events: z.number().int().nonnegative(),
    risk_residuals: z.number().int().nonnegative(),
    risk_opinions: z.number().int().nonnegative(),
    risk_opinion_events: z.number().int().nonnegative(),
    risk_publications: z.number().int().nonnegative(),
    risk_publication_targets: z.number().int().nonnegative(),
    risk_publication_acks: z.number().int().nonnegative(),
    risk_publication_events: z.number().int().nonnegative(),
  })
  .partial()
  .strict();
const manifestSchema = z
  .object({
    format: z.literal("pedit-local-sqlite-backup"),
    formatVersion: z.literal(1),
    database: z.literal(DB_FILE),
    schemaVersion: z.number().int().min(MIN_BACKUP_SCHEMA_VERSION).max(BACKUP_SCHEMA_VERSION),
    createdAt: z.iso.datetime(),
    bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    counts: countsSchema,
  })
  .strict();
export type BackupManifest = z.infer<typeof manifestSchema>;
async function safePath(value: string) {
  if (
    !isAbsolute(value) ||
    value.split(/[\\/]/).some((p) => p === ".." || p === ".") ||
    Array.from(value).some(
      (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
    )
  )
    throw new Error(
      "Use an absolute path without traversal/control components.",
    );
  const path = resolve(value);
  let part = parse(path).root;
  for (const name of path.slice(part.length).split(sep).filter(Boolean)) {
    part = join(part, name);
    try {
      const s = await lstat(part);
      if (s.isSymbolicLink())
        throw new Error("Symbolic links are not permitted.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
  return path;
}
async function regularFile(path: string) {
  await safePath(path);
  const s = await lstat(path);
  if (!s.isFile()) throw new Error("A regular file is required.");
  return s;
}
async function newDirectory(path: string) {
  await safePath(path);
  if (!(await lstat(dirname(path))).isDirectory())
    throw new Error("Destination parent must already be a directory.");
  await mkdir(path, { mode: 0o700 });
}
export async function hashBackupFile(path: string) {
  const before = await regularFile(path),
    hash = createHash("sha256");
  let bytes = 0;
  for await (const part of createReadStream(path)) {
    bytes += part.length;
    hash.update(part);
  }
  const after = await stat(path);
  if (
    bytes !== before.size ||
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs
  )
    throw new Error("Backup file changed while hashing.");
  return { bytes, sha256: hash.digest("hex") };
}
function health(db: DatabaseSync) {
  const schema = (
    db.prepare("PRAGMA user_version").get() as { user_version: number }
  ).user_version;
  if (schema < MIN_BACKUP_SCHEMA_VERSION || schema > BACKUP_SCHEMA_VERSION)
    throw new Error(
      "Backup schema is outside the supported range; this tool does not migrate.",
    );
  const rows = db.prepare("PRAGMA integrity_check").all();
  if (rows.length !== 1 || rows[0].integrity_check !== "ok")
    throw new Error("SQLite integrity check failed.");
  if (db.prepare("PRAGMA foreign_key_check").get())
    throw new Error("SQLite foreign-key check failed.");
  // Older schemas lack later tables; count only what exists so old bundles still verify.
  const exists = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
  );
  const counts = Object.fromEntries(
    countTables.filter((table) => exists.get(table)).map((table) => [
      table,
      (db.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n,
    ]),
  );
  return { schema, counts: countsSchema.parse(counts) };
}
async function noSidecars(path: string) {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try {
      await lstat(path + suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    throw new Error("Backup database sidecars are not permitted.");
  }
}
function readonly(path: string) {
  const db = new DatabaseSync(path, {
    readOnly: true,
    enableForeignKeyConstraints: true,
  });
  db.exec("PRAGMA trusted_schema=OFF;PRAGMA query_only=ON");
  return db;
}
export async function verifyBackup(
  bundleDirectory: string,
): Promise<BackupManifest> {
  const dir = await safePath(bundleDirectory);
  if (!(await lstat(dir)).isDirectory())
    throw new Error("Backup bundle directory required.");
  const mp = join(dir, MANIFEST),
    ms = await regularFile(mp);
  if (ms.size > 8192) throw new Error("Backup manifest exceeds8KiB.");
  const manifest = manifestSchema.parse(JSON.parse(await readFile(mp, "utf8"))),
    path = join(dir, DB_FILE),
    actual = await hashBackupFile(path);
  if (actual.bytes !== manifest.bytes || actual.sha256 !== manifest.sha256)
    throw new Error("Backup checksum/size mismatch.");
  await noSidecars(path);
  // Reject a WAL-mode header before SQLite can create new sidecars on open.
  const file = await open(path, "r");
  try {
    const header = Buffer.alloc(20);
    const { bytesRead } = await file.read(header, 0, 20, 0);
    if (
      bytesRead !== 20 ||
      header.subarray(0, 16).toString("binary") !== "SQLite format 3\0" ||
      header[18] !== 1 ||
      header[19] !== 1
    )
      throw new Error(
        "Backup must be a standalone rollback-journal SQLite file.",
      );
  } finally {
    await file.close();
  }
  const db = readonly(path);
  try {
    if (db.prepare("PRAGMA journal_mode").get()?.journal_mode !== "delete")
      throw new Error("Backup must use standalone DELETE journal mode.");
    const actual = health(db);
    if (
      actual.schema !== manifest.schemaVersion ||
      JSON.stringify(actual.counts) !== JSON.stringify(manifest.counts)
    )
      throw new Error("Backup schema or representative table counts mismatch.");
  } finally {
    db.close();
  }
  return manifest;
}
export async function createBackup(
  sourceDatabase: string,
  newBundleDirectory: string,
) {
  const source = await safePath(sourceDatabase),
    dest = await safePath(newBundleDirectory);
  await regularFile(source);
  let made = false;
  let sourceDb: DatabaseSync | undefined;
  try {
    sourceDb = readonly(source);
    health(sourceDb);
    await newDirectory(dest);
    made = true;
    const path = join(dest, DB_FILE);
    await backup(sourceDb, path);
    sourceDb.close();
    sourceDb = undefined;
    await chmod(path, 0o600);
    // Finalize only our new copy, never the source. Hash one standalone file.
    const standalone = new DatabaseSync(path);
    try {
      standalone.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      if (
        standalone.prepare("PRAGMA journal_mode=DELETE").get()?.journal_mode !==
        "delete"
      )
        throw new Error("Could not finalize standalone backup.");
    } finally {
      standalone.close();
    }
    await noSidecars(path);
    const copied = readonly(path);
    let checked;
    try {
      checked = health(copied);
    } finally {
      copied.close();
    }
    const manifest: BackupManifest = {
      format: "pedit-local-sqlite-backup",
      formatVersion: 1,
      database: DB_FILE,
      schemaVersion: checked.schema,
      createdAt: new Date().toISOString(),
      ...(await hashBackupFile(path)),
      counts: checked.counts,
    };
    await writeFile(
      join(dest, MANIFEST),
      JSON.stringify(manifest, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    await verifyBackup(dest);
    return manifest;
  } catch (error) {
    if (sourceDb) sourceDb.close();
    if (made) await rm(dest, { recursive: true, force: true });
    throw error;
  }
}
export async function restoreBackup(
  bundleDirectory: string,
  newRestoreDirectory: string,
) {
  const bundle = await safePath(bundleDirectory),
    dest = await safePath(newRestoreDirectory),
    manifest = await verifyBackup(bundle);
  if (dest === bundle || dest.startsWith(bundle + sep))
    throw new Error(
      "Restore destination must be outside the immutable backup bundle.",
    );
  let made = false;
  let db: DatabaseSync | undefined;
  try {
    await newDirectory(dest);
    made = true;
    const path = join(dest, DB_FILE);
    await copyFile(join(bundle, DB_FILE), path, constants.COPYFILE_EXCL);
    await chmod(path, 0o600);
    const copied = await hashBackupFile(path);
    if (copied.sha256 !== manifest.sha256 || copied.bytes !== manifest.bytes)
      throw new Error("Restore copy differs from verified bundle.");
    db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    db.exec("PRAGMA trusted_schema=OFF");
    const before = health(db).counts;
    if (JSON.stringify(before) !== JSON.stringify(manifest.counts))
      throw new Error("Restore table counts mismatch.");
    const invalid = db
      .prepare(
        "SELECT count(*) n FROM users u LEFT JOIN account_auth a ON a.user_id=u.id WHERE a.user_id IS NULL OR typeof(a.epoch)!='integer' OR a.epoch<1 OR a.epoch>=9007199254740991",
      )
      .get() as { n: number };
    if (invalid.n)
      throw new Error("Account epoch data cannot be safely advanced.");
    const sessionsBefore = (
      db.prepare("SELECT count(*) n FROM sessions").get() as { n: number }
    ).n;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(
        "DELETE FROM sessions;UPDATE account_auth SET epoch=epoch+1;COMMIT",
      );
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    const checkpoint = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() as {
      busy: number;
    };
    if (checkpoint.busy !== 0)
      throw new Error("Restore checkpoint remained busy.");
    health(db);
    db.close();
    db = undefined;
    const report = {
      format: "pedit-local-restore-report",
      formatVersion: 1,
      backupSha256: manifest.sha256,
      restoredDatabase: await hashBackupFile(path),
      schemaVersion: manifest.schemaVersion,
      representativeCounts: before,
      sessionsInvalidated: sessionsBefore,
      accountEpochsAdvanced: before.users ?? 0,
      recoveryRequired: true,
      passwordHashesRestoredFromBackup: true,
      sessionSecretRotationRequired: true,
      credentialRecoveryPolicyRequired: true,
      at: new Date().toISOString(),
    };
    await writeFile(
      join(dest, RECOVERY_MARKER),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    return { databasePath: path, report };
  } catch (error) {
    if (db) db.close();
    if (made) await rm(dest, { recursive: true, force: true });
    throw error;
  }
}
