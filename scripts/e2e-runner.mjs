import console from "node:console";
import process from "node:process";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const specs = [];
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (entry.isFile() && entry.name.endsWith(".spec.ts"))
      specs.push(relative(root, path).replaceAll("\\", "/"));
  }
}
collect(join(root, "tests", "e2e"));
specs.sort();

const usage = `Usage: npm run test:e2e -- [--list] [--headed] [--trace MODE] [SPEC ...]
SPEC is an exact project-relative path or an unambiguous spec filename.
With no SPEC, run all specs sequentially, each with a fresh synthetic server.
--list lists selected spec files without starting Playwright or a server.
Forwarded Playwright options: --headed; --trace off|on|retain-on-failure.
Build dist first. Production login limits and test assertions stay unchanged.`;
const selected = new Set();
const forwarded = [];
let listOnly = false;
const args = process.argv.slice(2);
try {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      console.log(usage);
      process.exit(0);
    }
    if (arg === "--list") {
      listOnly = true;
    } else if (arg === "--headed") {
      forwarded.push(arg);
    } else if (arg === "--trace" || arg.startsWith("--trace=")) {
      const value = arg === "--trace" ? args[++i] : arg.slice(8);
      if (!["off", "on", "retain-on-failure"].includes(value))
        throw new Error("--trace requires off, on, or retain-on-failure.");
      forwarded.push("--trace", value);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unsupported option: ${arg}`);
    } else {
      const normalized = arg.replaceAll("\\", "/").replace(/^\.\//, "");
      const matches = specs.filter(
        (spec) => spec === normalized || spec.split("/").at(-1) === normalized,
      );
      if (matches.length !== 1)
        throw new Error(`SPEC must match one existing spec file: ${arg}`);
      selected.add(matches[0]);
    }
  }
} catch (error) {
  console.error(error.message);
  console.error(usage);
  process.exit(2);
}
const files = selected.size ? specs.filter((spec) => selected.has(spec)) : specs;
if (!files.length) {
  console.error("No E2E spec files found.");
  process.exit(1);
}
if (listOnly) {
  console.log(files.join("\n"));
  console.log(`${files.length} spec file(s); no browser or server started.`);
  process.exit(0);
}

const require = createRequire(import.meta.url);
const cli = require.resolve("@playwright/test/cli");
const failures = [];
for (const [index, spec] of files.entries()) {
  console.log(`\n[${index + 1}/${files.length}] Fresh synthetic server: ${spec}`);
  // Playwright file filters are regexes; anchor one escaped path on both OSes.
  const pattern = spec
    .split("/")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[/\\\\]") + "$";
  const output = join("test-results", "e2e-runner", spec.slice(10, -8));
  const result = spawnSync(
    process.execPath,
    [cli, "test", pattern, "--output", output, ...forwarded],
    { cwd: root, env: process.env, stdio: "inherit", shell: false },
  );
  if (result.error) {
    console.error(`Cannot start Playwright: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    failures.push(spec);
    console.error(`FAILED: ${spec} (exit ${result.status}, signal ${result.signal || "none"})`);
  }
  // Playwright can translate an interrupt signal into an ordinary exit 130.
  if (result.signal || result.status === 130 || result.status === 143) {
    console.error("Runner interrupted; remaining specs were not run.");
    process.exit(
      result.signal === "SIGINT" || result.status === 130
        ? 130
        : result.signal === "SIGTERM" || result.status === 143
          ? 143
          : 1,
    );
  }
}
console.log(`\nE2E spec runs: ${files.length - failures.length} passed, ${failures.length} failed.`);
if (failures.length) console.error(failures.join("\n"));
process.exitCode = failures.length ? 1 : 0;
