import type { Express, Request } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { isLocalRequest, openSecret, sealSecret } from "./local-admin.js";
// SC-04: optional AI wording suggestion for one cost expense description. Off by default. Only the description text leaves
// the server (long digit runs masked); the suggestion is shown for the user to apply or ignore — nothing in the ledger changes.
// Keys: .env (AI_ENABLED=true + AI_MONTHLY_REQUEST_LIMIT, legacy) wins; otherwise the in-app setting picks one install-wide key
// or a key per account. Keys are stored AES-GCM encrypted with SESSION_SECRET and never sent back to the browser.
export type AiSuggest = (text: string, apiKey: string | undefined, model: string, system?: string) => Promise<string | null>;
export type AiConfig = { model: string; monthlyLimit: number; suggest: AiSuggest };
export type AiRuntime = { env?: AiConfig; suggest: AiSuggest; secret: string };
export const AI_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;
// IF NOT EXISTS: older-schema test fixtures drop only the tables they know about.
export function migrateAiUsage(db: Db) {
  db.exec(`
 CREATE TABLE IF NOT EXISTS ai_usage(month TEXT PRIMARY KEY,requests INTEGER NOT NULL CHECK(requests>=0));
 PRAGMA user_version=67;
`);
}
export function migrateAiKeys(db: Db) {
  db.exec(`
 CREATE TABLE IF NOT EXISTS ai_settings(id INTEGER PRIMARY KEY CHECK(id=1),mode TEXT NOT NULL CHECK(mode IN ('off','install','account')),model TEXT NOT NULL,updated_at TEXT NOT NULL,updated_by TEXT NOT NULL REFERENCES users(id));
 CREATE TABLE IF NOT EXISTS ai_keys(owner TEXT PRIMARY KEY,iv TEXT NOT NULL,tag TEXT NOT NULL,cipher TEXT NOT NULL,hint TEXT NOT NULL,monthly_limit INTEGER NOT NULL CHECK(monthly_limit>0),updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS ai_key_usage(owner TEXT NOT NULL,month TEXT NOT NULL,requests INTEGER NOT NULL CHECK(requests>=0),PRIMARY KEY(owner,month));
 PRAGMA user_version=68;
`);
}
export const maskForAi = (text: string) => text.replace(/\d[\d,.]{2,}/g, "#");
const SYSTEM = [
  "You rewrite one Korean line item description from a construction site's safety-cost ledger so it is clear and concise.",
  "Reply with only the rewritten description in Korean, at most 60 characters, with no quotes or explanation.",
  "Keep the original meaning. Do not add amounts, quantities, dates, names, companies or facts that are not in the input; keep '#' placeholders as they are.",
].join(" ");
// 결정 7 (문장 다듬기): wording only. The server picks the prompt by `kind`; the user applies the result or ignores it.
export const POLISH_KINDS = {
  journal_summary: "the day's work summary in a site safety journal",
  journal_safety: "the safety instructions given that day, as recorded in a site safety journal",
  tbm_topics: "the safety points delivered at a toolbox meeting (TBM)",
  minutes_decisions: "the decisions section of safety meeting minutes",
} as const;
export const polishSystem = (kind: keyof typeof POLISH_KINDS) => [
  `You polish Korean text written by construction site safety staff: ${POLISH_KINDS[kind]}.`,
  "Fix spelling, spacing and awkward or unclear sentences. Keep the meaning, order, facts, numbers, '#' placeholders and roughly the length.",
  "Do not add, remove or judge any fact, hazard, measure or compliance; do not add names, dates or amounts that are not in the input.",
  "Reply with only the polished Korean text, no quotes or explanation.",
].join(" ");
// Real call: Claude via the official SDK. Without an explicit key the SDK resolves .env ANTHROPIC_API_KEY or an `ant auth` profile.
export function anthropicSuggest(): AiSuggest {
  return async (text, apiKey, model, system = SYSTEM) => {
    const client = new Anthropic(apiKey ? { apiKey } : {});
    const response = await client.beta.messages.create({
      model,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // a safety decline is retried on a fallback model inside the same call
      output_config: { effort: "low" }, // a one-line rewrite needs little reasoning
      system,
      messages: [{ role: "user", content: text }],
    });
    if (response.stop_reason === "refusal") return null;
    const out = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    return out ? out.slice(0, 4000) : null;
  };
}
export function aiConfigFromEnv(): AiConfig | undefined {
  const limit = Number(process.env.AI_MONTHLY_REQUEST_LIMIT || 0);
  if (process.env.AI_ENABLED !== "true" || !Number.isInteger(limit) || limit <= 0) return undefined;
  const model = process.env.AI_MODEL || "claude-opus-5-5";
  return { model, monthlyLimit: limit, suggest: anthropicSuggest() };
}
type Settings = { mode: "off" | "install" | "account"; model: string };
type KeyRow = { owner: string; iv: string; tag: string; cipher: string; hint: string; monthly_limit: number };
const month = () => new Date().toISOString().slice(0, 7);
const keySchema = z.object({ apiKey: z.string().trim().min(20, "API 키를 확인하세요.").max(300).regex(/^\S+$/, "API 키에 공백이 있습니다."), monthlyLimit: z.number().int().min(1).max(100000) }).strict();
export function registerAiSuggest(app: Express, db: Db, { access }: SiteOperations, rt: AiRuntime) {
  const settings = () => (db.prepare("SELECT mode,model FROM ai_settings WHERE id=1").get() as Settings | undefined) ?? { mode: "off" as const, model: AI_MODELS[0] };
  const keyRow = (owner: string) => db.prepare("SELECT * FROM ai_keys WHERE owner=?").get(owner) as KeyRow | undefined;
  const used = (owner: string) => (db.prepare("SELECT requests FROM ai_key_usage WHERE owner=? AND month=?").get(owner, month()) as { requests: number } | undefined)?.requests ?? 0;
  // Which key (and cap) this user's request would use; null when AI is off or no key is registered.
  function resolve(userId: string): { owner: string; model: string; limit: number; row?: KeyRow; source: "env" | "app" } | null {
    if (rt.env) return { owner: "env", model: rt.env.model, limit: rt.env.monthlyLimit, source: "env" };
    const s = settings();
    if (s.mode === "off") return null;
    const owner = s.mode === "install" ? "install" : "user:" + userId, row = keyRow(owner);
    return row ? { owner, model: s.model, limit: row.monthly_limit, row, source: "app" } : null;
  }
  const signedIn = (req: Request) => { if (!req.session.userId) throw new HttpError(401, "로그인이 필요합니다."); return req.session.userId; };
  app.get("/api/ai/status", (req, res, next) => {
    try {
      const userId = signedIn(req), r = resolve(userId), s = settings(), mine = keyRow("user:" + userId), inst = keyRow("install");
      res.json({
        enabled: !!r, model: r?.model, remaining: r ? Math.max(0, r.limit - used(r.owner)) : undefined,
        source: rt.env ? "env" : "app", mode: rt.env ? "install" : s.mode, models: AI_MODELS, canManageInstall: !rt.env && isLocalRequest(req),
        installKey: inst ? { hint: inst.hint, monthlyLimit: inst.monthly_limit, used: used("install") } : null,
        myKey: mine ? { hint: mine.hint, monthlyLimit: mine.monthly_limit, used: used(mine.owner) } : null,
      });
    } catch (err) { next(err); }
  });
  const saveKey = (owner: string, body: unknown) => {
    const { apiKey, monthlyLimit } = keySchema.parse(body), sealed = sealSecret(rt.secret, apiKey);
    db.prepare("INSERT INTO ai_keys VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner) DO UPDATE SET iv=excluded.iv,tag=excluded.tag,cipher=excluded.cipher,hint=excluded.hint,monthly_limit=excluded.monthly_limit,updated_at=excluded.updated_at")
      .run(owner, sealed.iv, sealed.tag, sealed.cipher, "…" + apiKey.slice(-4), monthlyLimit, new Date().toISOString());
  };
  const installOnly = (req: Request) => {
    const userId = signedIn(req);
    if (rt.env) throw new HttpError(409, "AI 설정이 .env 파일로 관리되고 있습니다. .env의 AI_ENABLED를 지운 뒤 앱에서 설정하세요.");
    if (!isLocalRequest(req)) throw new HttpError(403, "PC 공용 AI 설정은 이 앱이 설치된 PC에서 직접 접속했을 때만 바꿀 수 있습니다.");
    return userId;
  };
  app.put("/api/ai/settings", (req, res, next) => {
    try {
      const userId = installOnly(req);
      const { mode, model } = z.object({ mode: z.enum(["off", "install", "account"]), model: z.enum(AI_MODELS) }).strict().parse(req.body);
      db.prepare("INSERT INTO ai_settings VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET mode=excluded.mode,model=excluded.model,updated_at=excluded.updated_at,updated_by=excluded.updated_by")
        .run(mode, model, new Date().toISOString(), userId);
     
      res.json({ ok: true });
    } catch (err) { next(err); }
  });
  app.put("/api/ai/install-key", (req, res, next) => {
    try { installOnly(req); saveKey("install", req.body); res.json({ ok: true }); }
    catch (err) { next(err); }
  });
  app.delete("/api/ai/install-key", (req, res, next) => {
    try { installOnly(req); db.prepare("DELETE FROM ai_keys WHERE owner='install'").run(); res.json({ ok: true }); }
    catch (err) { next(err); }
  });
  app.put("/api/ai/my-key", (req, res, next) => {
    try { const userId = signedIn(req); saveKey("user:" + userId, req.body); res.json({ ok: true }); }
    catch (err) { next(err); }
  });
  app.delete("/api/ai/my-key", (req, res, next) => {
    try { const userId = signedIn(req); db.prepare("DELETE FROM ai_keys WHERE owner=?").run("user:" + userId); res.json({ ok: true }); }
    catch (err) { next(err); }
  });
  // One suggestion request: resolve the key, charge the monthly cap, call the model, never touch any record.
  async function suggestFor(req: Request, text: string, event: string, system?: string) {
    const r = resolve(req.session.userId!);
    if (!r) throw new HttpError(404, "AI 기능이 꺼져 있거나 등록된 AI 키가 없습니다.");
    const apiKey = r.row ? openSecret(rt.secret, r.row) : undefined;
    if (r.row && !apiKey) throw new HttpError(409, "저장된 AI 키를 읽을 수 없습니다(서버 비밀값 변경). 키를 다시 등록하세요.");
    db.exec("BEGIN IMMEDIATE");
    try {
      if (used(r.owner) >= r.limit) throw new HttpError(429, "이번 달 AI 요청 한도를 다 썼습니다.");
      db.prepare("INSERT INTO ai_key_usage VALUES(?,?,1) ON CONFLICT(owner,month) DO UPDATE SET requests=requests+1").run(r.owner, month());
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    audit(db, req.session.userId!, String(req.params.siteId), event, `${r.model} ${r.owner === "install" || r.owner === "env" ? r.owner : "account"}`);
    let suggestion: string | null;
    try { suggestion = await (rt.env?.suggest ?? rt.suggest)(text, apiKey, r.model, system); }
    catch (e) {
      if (e instanceof Anthropic.RateLimitError) throw new HttpError(503, "AI 서비스가 바쁩니다. 잠시 뒤 다시 시도하세요.");
      if (e instanceof Anthropic.AuthenticationError) throw new HttpError(503, "AI 키가 맞지 않습니다. 키를 다시 확인하세요.");
      throw new HttpError(502, "AI 제안을 받지 못했습니다. 입력은 그대로입니다.");
    }
    if (!suggestion) throw new HttpError(422, "AI가 이 문구에 제안을 하지 않았습니다.");
    return { suggestion, sent: text, model: r.model };
  }
  app.post("/api/sites/:siteId/ai/expense-description", async (req, res, next) => {
    try {
      access(req, true, true);
      const text = maskForAi(z.object({ text: z.string().trim().min(1, "내용을 입력한 뒤 제안을 받으세요.").max(200) }).strict().parse(req.body).text);
      res.json(await suggestFor(req, text, "ai.expense_description"));
    } catch (err) { next(err); }
  });
  app.post("/api/sites/:siteId/ai/polish", async (req, res, next) => {
    try {
      access(req, true); // editors write journals, TBMs and minutes too
      const { kind, text } = z.object({
        kind: z.enum(Object.keys(POLISH_KINDS) as [keyof typeof POLISH_KINDS, ...(keyof typeof POLISH_KINDS)[]]),
        text: z.string().trim().min(1, "글을 쓴 뒤 다듬기를 받으세요.").max(4000, "4000자까지만 다듬을 수 있습니다."),
      }).strict().parse(req.body);
      res.json(await suggestFor(req, maskForAi(text), "ai.polish:" + kind, polishSystem(kind)));
    } catch (err) { next(err); }
  });
}
