import { assertRecoveryReady } from "./recovery-gate.js";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import express from "express";
import { openDatabase } from "./db.js";
import { createApp } from "./app.js";
import { localPermissionWarnings as localPermissionWarningsFor } from "./local-permissions.js";
import { aiConfigFromEnv } from "./ai-suggest.js";
import { DEFAULT_ADS_FEED } from "./ads.js";
import { publicOrigin, readPublicSettings, type PublicRuntime } from "./public-access.js";
import { startDirect, startTunnel } from "./public-serve.js";
import { selfCheck } from "./public-checks.js";
if (existsSync(".env")) process.loadEnvFile(".env");
// SEC-LOCAL-01 B안: files this process creates (DB WAL/SHM) are owner-only on POSIX; Windows uses ACLs instead.
if (process.platform !== "win32") process.umask(0o077);
if (process.env.NODE_ENV === "production")
  throw new Error(
    "Production deployment is not supported by this foundation. Complete HANDOFF gates first.",
  );
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("PORT must be 1024–65535.");
const databasePath = process.env.DB_PATH || "./data/pedit.sqlite";
assertRecoveryReady(databasePath);
const db = openDatabase(databasePath);
const localPermissionWarnings = localPermissionWarningsFor(databasePath);
for (const w of localPermissionWarnings) console.warn("SEC-LOCAL-01 경고:", w);
const secret = process.env.SESSION_SECRET || "";
// Self-hosting settings are read once here; changing them on the settings screen takes effect at the next start.
const pub = readPublicSettings(db, secret);
const runtime: PublicRuntime = { mode: pub.mode, origin: publicOrigin(pub), state: pub.mode === "off" ? "꺼짐" : "시작 중", launcher: process.env.YWEB_LAUNCHER === "1" };
if (pub.mode === "tunnel" && !pub.tunnelToken) Object.assign(runtime, { mode: "off", origin: undefined, state: "꺼짐", detail: "저장된 터널 토큰을 읽을 수 없습니다(SESSION_SECRET 변경). 토큰을 다시 입력하세요." });
const app = await createApp(db, {
  secret,
  origin: process.env.APP_ORIGIN || `http://127.0.0.1:${port}`,
  // 광고 (docs/ADS.md): always on; ADS_FEED_URL only changes the feed address.
  ads: { feedUrl: process.env.ADS_FEED_URL || DEFAULT_ADS_FEED, dir: resolve(dirname(databasePath), "ads") },
  localPermissionWarnings,
  ai: aiConfigFromEnv(),
  publicOrigin: runtime.origin,
  trustProxy: runtime.mode === "tunnel",
  publicRuntime: runtime,
});
app.use(express.static(resolve("dist"), { index: false }));
app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
const server = app.listen(port, "127.0.0.1", () =>
  console.log(`PEDIT local foundation: http://127.0.0.1:${port}`),
);
// 적용 확인 shown in the wizard: open our own public address once it is being served.
async function verify(mode: "direct" | "tunnel") { if (runtime.origin) runtime.selfCheck = await selfCheck(runtime.origin, mode); }
// A failure here leaves the local app running; the reason is shown on the 외부 접속 설정 screen and in this console.
let publicServer: { close: () => void } | undefined;
const fail = (e: Error) => { Object.assign(runtime, { state: "중지", detail: e.message }); console.error("외부 접속 시작 실패:", e.message); };
if (runtime.mode === "direct")
  startDirect(app, pub, runtime, { dir: resolve(process.env.TLS_DIR || "./data/tls"), httpPort: Number(process.env.PUBLIC_HTTP_PORT || 80), httpsPort: Number(process.env.PUBLIC_HTTPS_PORT || 443) })
    .then((s) => { publicServer = s; console.log("외부 접속:", runtime.detail); return verify("direct"); }).catch(fail);
if (runtime.mode === "tunnel" && pub.tunnelToken) publicServer = startTunnel(pub.tunnelToken, runtime, { onRunning: () => void verify("tunnel") });
const shutdown = (code: number) =>
  server.close(() => {
    publicServer?.close();
    db.close();
    process.exit(code);
  });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => shutdown(0));
// 75 asks start.cmd (scripts/start-windows.ps1) to start the app again, so new 외부 접속 settings apply with one button.
app.locals.requestRestart = () => shutdown(75);
