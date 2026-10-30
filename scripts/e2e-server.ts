import { randomUUID } from "node:crypto";
import express from "express";
import argon2 from "argon2";
import { resolve } from "node:path";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
const db = openDatabase(":memory:");
const hash = await argon2.hash("synthetic-e2e-password");
db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
  "00000000-0000-4000-8000-000000000001",
  "test@example.test",
  "테스트 작성자",
  hash,
);
db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
  "00000000-0000-4000-8000-000000000002",
  "editor@example.test",
  "합성 조치담당",
  hash,
);
// Dedicated synthetic account so password UI scenarios do not alter other fixtures.
db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
  "00000000-0000-4000-8000-000000000003",
  "password-change@example.test",
  "합성 비밀번호 시험",
  hash,
);
const app = await createApp(db, {
  secret: randomUUID() + randomUUID(),
  origin: "http://127.0.0.1:3107",
  adsEnabled: process.env.TEST_ADS === "true",
});
app.use(express.static(resolve("dist")));
app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
app.listen(3107, "127.0.0.1");
