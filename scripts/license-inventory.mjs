import { readFileSync, writeFileSync } from "node:fs";
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const rows = Object.entries(lock.packages)
  .filter(([path]) => path)
  .map(
    ([path, p]) =>
      `| ${path.replace(/^node_modules\//, "")} | ${p.version} | ${p.license || "UNKNOWN — inspect before release"} | ${p.dev ? "development" : "runtime/optional"} |`,
  );
writeFileSync(
  "docs/DEPENDENCIES.md",
  `# Dependency / license inventory\n\nGenerated from package-lock.json, including transitive and platform-optional packages. Metadata only, not legal clearance. Inspect actual LICENSE/NOTICE before redistribution. Application license: MIT (see LICENSE). Node/browser/OS are separate runtimes.\n\nRegenerate: node scripts/license-inventory.mjs. Integrity hashes are in package-lock.json.\n\nBundled font (not an npm package): Pretendard Variable 1.3.9, SIL Open Font License 1.1 — public/fonts/PretendardVariable.woff2, license text in public/fonts/LICENSE-Pretendard-OFL.txt (UI 개편 결정 2026-10-31).\n\n| Package path | Version | Declared license | Class |\n|---|---|---|---|\n${rows.join("\n")}\n`,
);
