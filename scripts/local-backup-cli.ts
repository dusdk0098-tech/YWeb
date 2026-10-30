// Explicit local command only. No environment loading, migration or restore.
import { createBackup, verifyBackup, BACKUP_SCHEMA_VERSION } from "./local-backup.js";

const help = `Local backup commands (supported schema ${BACKUP_SCHEMA_VERSION}):
  export --source /absolute/database.sqlite --destination /absolute/new-bundle --writers-stopped
  verify --bundle /absolute/bundle
  list --bundle /absolute/bundle
Export requires an operator assertion that all writers are stopped; this command does not verify process state.
Bundles contain password hashes, sessions, personal data and unscanned originals. No encryption, transmission or recovery activation is provided.`;
type Command = { kind: "export"; source: string; destination: string } | { kind: "verify" | "list"; bundle: string };
function parse(args: string[]): Command {
  const [kind, ...rest] = args;
  if (kind !== "export" && kind !== "verify" && kind !== "list") throw new Error("usage");
  const values = new Map<string, string>();
  let stopped = false;
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (key === "--writers-stopped" && kind === "export" && !stopped) {
      stopped = true;
      continue;
    }
    const allowed = kind === "export" ? ["--source", "--destination"] : ["--bundle"];
    if (!allowed.includes(key) || values.has(key)) throw new Error("usage");
    const value = rest[++i];
    if (!value || value.startsWith("--")) throw new Error("usage");
    values.set(key, value);
  }
  if (kind === "export") {
    if (!stopped || values.size !== 2) throw new Error("usage");
    return { kind, source: values.get("--source")!, destination: values.get("--destination")! };
  }
  if (values.size !== 1) throw new Error("usage");
  return { kind, bundle: values.get("--bundle")! };
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") { console.log(help); return; }
  let command: Command;
  try { command = parse(args); }
  catch { console.error(help); process.exitCode = 2; return; }
  console.error("LOCAL ONLY: Backup contains sensitive account and business data and unscanned originals. Protect access. Writer-stop assertion is not process verification.");
  try {
    const manifest = command.kind === "export"
      ? await createBackup(command.source, command.destination)
      : await verifyBackup(command.bundle);
    // Only validated, fixed-shape manifest metadata is emitted, never SQL or rows.
    if (command.kind === "list") console.log(JSON.stringify({ verified: true, files: ["database.sqlite", "manifest.json"], manifest }, null, 2));
    else console.log(JSON.stringify({ operation: command.kind, verified: true, schemaVersion: manifest.schemaVersion, bytes: manifest.bytes, sha256: manifest.sha256 }));
  } catch {
    console.error("Backup operation failed. Check explicit absolute paths, permissions, destination absence, supported schema, available space and bundle integrity. No restore or migration was attempted.");
    process.exitCode = 1;
  }
}
await main();
