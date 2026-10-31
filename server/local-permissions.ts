import { existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { hostname, userInfo } from "node:os";
import { dirname, resolve } from "node:path";
// SEC-LOCAL-01 A안: read-only check of the local data paths. Never changes permissions.
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
export function localPermissionWarnings(databasePath: string, envPath = ".env") {
  const db = resolve(databasePath),
    paths = [dirname(db), db, db + "-wal", db + "-shm", resolve(envPath)].filter((p) => existsSync(p)),
    self = `${process.env.USERDOMAIN || hostname()}\\${userInfo().username}`,
    warnings: string[] = [];
  for (const p of paths) {
    try {
      if (process.platform === "win32") {
        // shortcut: decodes icacls output as CP949 (Korean Windows); other code pages may garble non-ASCII account names in the message only.
        const readers = aclReaders(new TextDecoder("euc-kr").decode(execFileSync("icacls", [p], { windowsHide: true })), p, self);
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
