import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { openDatabase } from "../server/db.js";
import { createApp } from "../server/app.js";
import { aiConfigFromEnv, maskForAi, type AiConfig, type AiSuggest } from "../server/ai-suggest.js";
const origin = "http://127.0.0.1:3000";
async function fixture(ai?: AiConfig, aiSuggest?: AiSuggest) {
  const db = openDatabase(":memory:"), site = randomUUID(), password = randomUUID(), hash = await argon2.hash(password), ids: Record<string, string> = {};
  db.prepare("INSERT INTO sites(id,name) VALUES(?,?)").run(site, "합성");
  for (const role of ["manager", "editor"]) {
    ids[role] = randomUUID();
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(ids[role], role + "@example.test", role, hash);
    db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(site, ids[role], role);
  }
  const app = await createApp(db, { origin, secret: "synthetic-ai-secret-".repeat(3), ai, aiSuggest });
  const login = async (name: string) => {
    const agent = request.agent(app);
    let r = await agent.get("/api/session");
    r = await agent.post("/api/login").set("Origin", origin).set("x-csrf-token", r.body.csrf).send({ email: name + "@example.test", password });
    return { agent, csrf: r.body.csrf as string };
  };
  const m = await login("manager"), e = await login("editor");
  const ask = (a: typeof m, text: string) => a.agent.post(`/api/sites/${site}/ai/expense-description`).set("Origin", origin).set("x-csrf-token", a.csrf).send({ text });
  const put = (a: typeof m, path: string, body: unknown, extra: Record<string, string> = {}) => {
    let r = a.agent.put("/api/ai/" + path).set("Origin", origin).set("x-csrf-token", a.csrf);
    for (const [k, v] of Object.entries(extra)) r = r.set(k, v);
    return r.send(body as object);
  };
  return { db, m, e, ask, put, site };
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
    const s = (await f.m.agent.get("/api/ai/status")).body;
    assert.deepEqual([s.enabled, s.mode, s.source, s.myKey, s.installKey], [false, "off", "app", null, null]);
    assert.equal((await f.ask(f.m, "안전난간")).status, 404);
  } finally { f.db.close(); }
});
test(".env AI: manager only, only masked text sent, monthly cap, refusal and errors keep input", async () => {
  const sent: string[] = [];
  let reply: string | null | Error = "안전난간 설치(# 구간)";
  const f = await fixture({ model: "claude-opus-5-5", monthlyLimit: 3, suggest: async (t) => { sent.push(t); if (reply instanceof Error) throw reply; return reply; } });
  try {
    const s = (await f.m.agent.get("/api/ai/status")).body;
    assert.deepEqual([s.enabled, s.model, s.remaining, s.source, s.canManageInstall], [true, "claude-opus-5-5", 3, "env", false]);
    assert.equal((await f.put(f.m, "settings", { mode: "account", model: "claude-opus-5-5" })).status, 409); // .env wins
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
test("문장 다듬기: editors too, kind required, masked text, wording prompt, same monthly cap", async () => {
  const sent: { text: string; system?: string }[] = [];
  const f = await fixture({ model: "claude-opus-5-5", monthlyLimit: 2, suggest: async (t, _k, _m, system) => { sent.push({ text: t, system }); return "다듬은 " + t; } });
  try {
    const polish = (a: typeof f.m, body: object) => a.agent.post(`/api/sites/${f.site}/ai/polish`).set("Origin", origin).set("x-csrf-token", a.csrf).send(body);
    assert.equal((await polish(f.e, { kind: "expense", text: "x" })).status, 400);
    assert.equal((await polish(f.e, { kind: "tbm_topics", text: "x".repeat(4001) })).status, 400);
    const r = await polish(f.e, { kind: "tbm_topics", text: "개구부 덮개 확인 2026년 11월 1일" });
    assert.deepEqual([r.status, r.body.suggestion, r.body.sent], [200, "다듬은 개구부 덮개 확인 #년 11월 1일", "개구부 덮개 확인 #년 11월 1일"]);
    assert.match(sent[0].system ?? "", /toolbox meeting/);
    assert.match(sent[0].system ?? "", /Do not add, remove or judge/);
    assert.equal((await polish(f.m, { kind: "journal_summary", text: "작업 요약" })).status, 200);
    assert.equal((await polish(f.m, { kind: "minutes_decisions", text: "결정" })).status, 429); // cap shared with the ledger suggestion
    assert.equal((f.db.prepare("SELECT count(*) n FROM audit WHERE event LIKE 'ai.polish:%'").get() as { n: number }).n, 2);
  } finally { f.db.close(); }
});
test("in-app keys: install-wide or per account, sealed at rest, install settings only from this PC", async () => {
  const calls: [string, string | undefined, string][] = [];
  const f = await fixture(undefined, async (t, key, model) => { calls.push([t, key, model]); return "제안"; });
  const installKey = "sk-ant-install-" + "a".repeat(30), myKey = "sk-ant-account-" + "b".repeat(30);
  try {
    assert.equal((await f.m.agent.get("/api/ai/status")).body.canManageInstall, true);
    // A tunnel or proxy hop is never treated as this PC, even though cloudflared connects from 127.0.0.1.
    assert.equal((await f.put(f.m, "settings", { mode: "install", model: "claude-sonnet-5-5" }, { "cf-connecting-ip": "203.0.113.9" })).status, 403);
    assert.equal((await f.put(f.m, "settings", { mode: "install", model: "claude-sonnet-5-5" }, { Host: "site.example.com" })).status, 403);
    assert.equal((await f.put(f.m, "settings", { mode: "install", model: "gpt" })).status, 400);
    assert.equal((await f.put(f.m, "settings", { mode: "install", model: "claude-sonnet-5-5" })).status, 200);
    assert.equal((await f.ask(f.m, "안전난간")).status, 404); // no install key yet
    assert.equal((await f.put(f.m, "install-key", { apiKey: "short", monthlyLimit: 5 })).status, 400);
    assert.equal((await f.put(f.m, "install-key", { apiKey: installKey, monthlyLimit: 2 })).status, 200);
    const sealed = JSON.stringify(f.db.prepare("SELECT * FROM ai_keys").all());
    assert.ok(!sealed.includes(installKey) && !sealed.includes("install-" + "a".repeat(10)), "key must be encrypted at rest");
    const s = (await f.e.agent.get("/api/ai/status")).body;
    assert.deepEqual([s.enabled, s.mode, s.installKey.hint, s.installKey.monthlyLimit], [true, "install", "…aaaa", 2]);
    assert.ok(!JSON.stringify(s).includes(installKey));
    assert.equal((await f.ask(f.m, "안전난간 1500000원")).status, 200);
    assert.deepEqual(calls.at(-1), ["안전난간 #원", installKey, "claude-sonnet-5-5"]);
    // Account mode: each user's own key and own cap; the install key is no longer used.
    assert.equal((await f.put(f.m, "settings", { mode: "account", model: "claude-opus-5-5" })).status, 200);
    assert.equal((await f.ask(f.m, "안전난간")).status, 404);
    assert.equal((await f.put(f.m, "my-key", { apiKey: myKey, monthlyLimit: 1 })).status, 200);
    assert.equal((await f.ask(f.m, "안전난간")).status, 200);
    assert.deepEqual(calls.at(-1)?.slice(1), [myKey, "claude-opus-5-5"]);
    assert.equal((await f.ask(f.m, "안전난간")).status, 429);
    assert.equal((await f.m.agent.get("/api/ai/status")).body.myKey.used, 1);
    // A key that no longer decrypts (SESSION_SECRET changed) asks for re-registration instead of calling the API.
    f.db.prepare("DELETE FROM ai_key_usage").run();
    f.db.prepare("UPDATE ai_keys SET tag=? WHERE owner LIKE 'user:%'").run(Buffer.alloc(16).toString("base64"));
    assert.equal((await f.ask(f.m, "안전난간")).status, 409);
    assert.equal(calls.length, 2);
  } finally { f.db.close(); }
});
