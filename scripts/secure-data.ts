// SEC-LOCAL-01 B안: make the local data folder, its files, .env and an optional backup folder owner-only.
// Default is a dry run; nothing changes without --apply. Stop the server and confirm a backup first.
import { existsSync } from "node:fs";
import { secureApply, securePlan, secureTargets } from "../server/local-permissions.js";
if (existsSync(".env")) process.loadEnvFile(".env");
const args = process.argv.slice(2), apply = args.includes("--apply"), at = args.indexOf("--backup");
const plan = securePlan(secureTargets(process.env.DB_PATH || "./data/pedit.sqlite", ".env", at >= 0 ? args[at + 1] : undefined));
if (!plan.length) {
  console.log("정리할 데이터 경로가 없습니다.");
  process.exit(0);
}
for (const step of plan)
  console.log("command" in step ? `icacls ${step.command.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}  (+ 남은 다른 계정 권한 제거)` : `chmod ${step.mode.toString(8)} ${step.path}`);
if (!apply) {
  console.log("\n미리보기입니다. 아무것도 바꾸지 않았습니다. 서버를 끄고 백업을 확인한 뒤 --apply 를 붙여 다시 실행하세요.");
  process.exit(0);
}
const remaining = secureApply(plan);
console.log(remaining.length ? `\n아직 열려 있는 경로:\n${remaining.join("\n")}` : "\n완료: 모든 경로가 본인(및 SYSTEM·Administrators) 전용입니다.");
process.exit(remaining.length ? 1 : 0);
