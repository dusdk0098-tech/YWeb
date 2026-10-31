import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { aiConfigFromEnv, maskForAi, type AiConfig } from "../server/ai-suggest.js";
const origin = "http://127.0.0.1:3000";
async function fixture(ai?: AiConfig) {
  const db = openDatabase(":memory:"), site = randomUUID(), password = randomUUID(), hash = await argon2.hash(password), ids: Record<string, string> = {};
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site, "합성");
  for (const role of ["manager", "editor"]) {
    ids[role] = randomUUID();
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(ids[role], role + "@example.test", role, hash);
    db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site, ids[role], role);
  }
  const app = await createApp(db, { origin, secret: "synthetic-ai-secret-".repeat(3), ai });
  const login = async (name: string) => {
    const agent = request.agent(app);
    let r = await agent.get("/api/session");
    r = await agent.post("/api/login").set("Origin", origin).set("x-csrf-token", r.body.csrf).send({ email: name + "@example.test", password });
    return { agent, csrf: r.body.csrf as string };
  };
  const m = await login("manager"), e = await login("editor");
  const ask = (a: typeof m, text: string) => a.agent.post(`/api/sites/${site}/ai/expense-description`).set("Origin", origin).set("x-csrf-token", a.csrf).send({ text });
  return { db, m, e, ask };
}
test("AI suggestion is off by default and masks long digit runs", async () => {
  for (const k of ["AI_ENABLED", "AI_MONTHLY_REQUEST_LIMIT"]) delete process.env[k];
  assert.equal(aiConfigFromEnv(), undefined);
  process.env.AI_ENABLED = "true"; process.env.AI_MONTHLY_REQUEST_LIMIT = "0";
  assert.equal(aiConfigFromEnv(), undefined); // a cap is required
  delete process.env.AI_ENABLED; delete process.env.AI_MONTHLY_REQUEST_LIMIT;
  assert.equal(maskForAi("안전난간 1,250,000원 12m 설치 7월3일"), "안전난간 #원 12m 설치 7월3일");
  const f = await fixture();
  try {
    assert.deepEqual((await f.m.agent.get("/api/ai/status")).body, { enabled: false });
    assert.equal((await f.ask(f.m, "안전난간")).status, 404);
  } finally { f.db.close(); }
});
test("AI suggestion: manager only, only masked text sent, monthly cap, refusal and errors keep input", async () => {
  const sent: string[] = [];
  let reply: string | null | Error = "안전난간 설치(# 구간)";
  const f = await fixture({ model: "claude-opus-5-5", monthlyLimit: 3, suggest: async (t) => { sent.push(t); if (reply instanceof Error) throw reply; return reply; } });
  try {
    assert.deepEqual((await f.m.agent.get("/api/ai/status")).body, { enabled: true, model: "claude-opus-5-5", remaining: 3 });
    assert.equal((await f.ask(f.e, "안전난간")).status, 403);
    assert.equal((await f.ask(f.m, " ")).status, 400);
    const r = await f.ask(f.m, "안전난간 설치 2500000원");
    assert.deepEqual([r.status, r.body.suggestion, r.body.sent], [200, "안전난간 설치(# 구간)", "안전난간 설치 #원"]);
    assert.deepEqual(sent, ["안전난간 설치 #원"]);
    reply = null;
    assert.equal((await f.ask(f.m, "x")).status, 422);
    reply = new Error("network");
    assert.equal((await f.ask(f.m, "y")).status, 502);
    assert.equal((await f.ask(f.m, "z")).status, 429); // 3 requests used this month
    assert.equal(sent.length, 3);
    assert.equal((await f.m.agent.get("/api/ai/status")).body.remaining, 0);
    assert.equal((f.db.prepare("SELECT count(*) n FROM cost_expenses").get() as { n: number }).n, 0); // nothing written to the ledger
  } finally { f.db.close(); }
});
