import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { hostname, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
// SEC-LOCAL-01 A안: read-only check of the local data paths (never changes permissions); B안 below changes them only when run explicitly.
const READ = new Set(["F", "M", "RX", "R", "GR", "GA", "RD"]), INHERIT = new Set(["I", "OI", "CI", "IO", "NP"]);
const TRUSTED = ["NT AUTHORITY\\SYSTEM", "BUILTIN\\Administrators"];
// Principals other than self/SYSTEM/Administrators that icacls lists with read access. Inherit-only (IO) ACEs do not apply to the path itself.
export function aclReaders(output: string, path: string, self: string) {
  const trusted = [...TRUSTED, self].map((x) => x.toLowerCase()), readers: string[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = (raw.startsWith(path) ? raw.slice(path.length) : raw).trim(), m = /^(.+?):((?:\([A-Z,]+\))+)$/.exec(line);
    if (!m) continue;
    const tokens = m[2].slice(1, -1).split(")(").flatMap((x) => x.split(","));
    if (tokens.includes("IO") || !tokens.some((t) => !INHERIT.has(t) && READ.has(t))) continue;
    if (!trusted.includes(m[1].toLowerCase()) && !readers.includes(m[1])) readers.push(m[1]);
  }
  return readers;
}
const selfName = () => `${process.env.USERDOMAIN || hostname()}\\${userInfo().username}`;
// shortcut: decodes icacls output as CP949 (Korean Windows); other code pages may garble non-ASCII account names in messages only.
const icacls = (args: string[]) => new TextDecoder("euc-kr").decode(execFileSync("icacls", args, { windowsHide: true }));
export function pathWarnings(paths: string[]) {
  const warnings: string[] = [];
  for (const p of paths) {
    try {
      if (process.platform === "win32") {
        const readers = aclReaders(icacls([p]), p, selfName());
        if (readers.length) warnings.push(`${p}: 본인·SYSTEM·Administrators 외 계정이 읽을 수 있습니다 (${readers.join(", ")}).`);
      } else {
        const mode = statSync(p).mode & 0o777;
        if (mode & 0o077) warnings.push(`${p}: 권한 ${mode.toString(8)} — 그룹·다른 사용자가 접근할 수 있습니다.`);
      }
    } catch {
      warnings.push(`${p}: 권한을 확인하지 못했습니다.`);
    }
  }
  return warnings;
}
export function localPermissionWarnings(databasePath: string, envPath = ".env") {
  const db = resolve(databasePath);
  return pathWarnings([dirname(db), db, db + "-wal", db + "-shm", resolve(envPath)].filter((p) => existsSync(p)));
}
// SEC-LOCAL-01 B안 (approved): owner-only permissions, run explicitly by the operator (scripts/secure-data.ts, dry-run first).
export function secureTargets(databasePath: string, envPath = ".env", backupDir?: string) {
  const walk = (d: string): string[] => [d, ...readdirSync(d, { withFileTypes: true }).flatMap((x) => (x.isDirectory() ? walk(join(d, x.name)) : [join(d, x.name)]))];
  const dataDir = dirname(resolve(databasePath));
  return [
    ...(existsSync(dataDir) ? [dataDir, ...readdirSync(dataDir, { withFileTypes: true }).filter((x) => x.isFile()).map((x) => join(dataDir, x.name))] : []),
    ...(existsSync(envPath) ? [resolve(envPath)] : []),
    ...(backupDir && existsSync(backupDir) ? walk(resolve(backupDir)) : []),
  ];
}
type Step = { path: string; command: string[] } | { path: string; mode: number };
export function securePlan(paths: string[], platform = process.platform, self = selfName()): Step[] {
  return paths.map((p) => {
    const dir = statSync(p).isDirectory();
    // Well-known SIDs avoid localized names: S-1-5-18 SYSTEM, S-1-5-32-544 Administrators.
    return platform === "win32"
      ? { path: p, command: [p, "/inheritance:r", "/grant:r", ...[self, "*S-1-5-18", "*S-1-5-32-544"].map((t) => `${t}:${dir ? "(OI)(CI)" : ""}F`)] }
      : { path: p, mode: dir ? 0o700 : 0o600 };
  });
}
// Applies the plan, removes any remaining explicit ACE for other accounts, and returns what still looks open.
export function secureApply(plan: Step[]) {
  for (const step of plan) {
    if ("command" in step) {
      icacls(step.command);
      for (const other of aclReaders(icacls([step.path]), step.path, selfName())) icacls([step.path, "/remove:g", other]);
    } else chmodSync(step.path, step.mode);
  }
  return pathWarnings(plan.map((s) => s.path));
}
