import { assertRecoveryReady } from "./recovery-gate.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { openDatabase } from "./db.js";
import { createApp } from "./app.js";
if (existsSync(".env")) process.loadEnvFile(".env");
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
const app = await createApp(db, {
  secret: process.env.SESSION_SECRET || "",
  origin: process.env.APP_ORIGIN || `http://127.0.0.1:${port}`,
  adsEnabled: process.env.ADS_ENABLED === "true",
});
app.use(express.static(resolve("dist"), { index: false }));
app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
const server = app.listen(port, "127.0.0.1", () =>
  console.log(`PEDIT local foundation: http://127.0.0.1:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
