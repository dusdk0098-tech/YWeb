import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { z } from "zod";
import { openDatabase } from "../server/db.js";
if (existsSync(".env")) process.loadEnvFile(".env");
// Password arrives via stdin, never a command-line argument or committed fixture.
let password = "";
for await (const part of process.stdin) password += part;
password = password.replace(/\r?\n$/, "");
const input = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    name: z.string().trim().min(1).max(200),
    password: z.string().min(12).max(128),
  })
  .parse({ email: process.argv[2], name: process.argv[3], password });
const hash = await argon2.hash(input.password, { type: argon2.argon2id });
const db = openDatabase(process.env.DB_PATH || "./data/pedit.sqlite");
try {
  db.prepare(
    "INSERT INTO users(id,email,name,password_hash) VALUES(?,?,?,?)",
  ).run(randomUUID(), input.email, input.name, hash);
  console.log("Account created. No automatic site access.");
} finally {
  db.close();
}
