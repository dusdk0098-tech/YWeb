import type { Express } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
// SC-04 1단계 ("권장대로"): optional AI wording suggestion for one cost expense description. Off unless AI_ENABLED=true and
// AI_MONTHLY_REQUEST_LIMIT>0. Only the description text leaves the server (long digit runs masked); the suggestion is shown
// for the user to apply or ignore — nothing in the ledger changes here, and every feature works with AI off.
export type AiConfig = { model: string; monthlyLimit: number; suggest: (text: string) => Promise<string | null> };
// IF NOT EXISTS: older-schema test fixtures drop only the tables they know about.
export function migrateAiUsage(db: Db) {
  db.exec(`
 CREATE TABLE IF NOT EXISTS ai_usage(month TEXT PRIMARY KEY,requests INTEGER NOT NULL CHECK(requests>=0));
 PRAGMA user_version=67;
`);
}
export const maskForAi = (text: string) => text.replace(/\d[\d,.]{2,}/g, "#");
const SYSTEM = [
  "You rewrite one Korean line item description from a construction site's safety-cost ledger so it is clear and concise.",
  "Reply with only the rewritten description in Korean, at most 60 characters, with no quotes or explanation.",
  "Keep the original meaning. Do not add amounts, quantities, dates, names, companies or facts that are not in the input; keep '#' placeholders as they are.",
].join(" ");
// Real call: Claude via the official SDK; credentials resolve from the environment (.env ANTHROPIC_API_KEY or an `ant auth` profile).
export function anthropicSuggest(model: string): AiConfig["suggest"] {
  const client = new Anthropic();
  return async (text) => {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default", // a safety decline is retried on a fallback model inside the same call
      output_config: { effort: "low" }, // a one-line rewrite needs little reasoning
      system: SYSTEM,
      messages: [{ role: "user", content: text }],
    });
    if (response.stop_reason === "refusal") return null;
    const out = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    return out ? out.slice(0, 200) : null;
  };
}
export function aiConfigFromEnv(): AiConfig | undefined {
  const limit = Number(process.env.AI_MONTHLY_REQUEST_LIMIT || 0);
  if (process.env.AI_ENABLED !== "true" || !Number.isInteger(limit) || limit <= 0) return undefined;
  const model = process.env.AI_MODEL || "claude-opus-5-5";
  return { model, monthlyLimit: limit, suggest: anthropicSuggest(model) };
}
const month = () => new Date().toISOString().slice(0, 7);
const used = (db: Db) => (db.prepare("SELECT requests FROM ai_usage WHERE month=?").get(month()) as { requests: number } | undefined)?.requests ?? 0;
export function registerAiSuggest(app: Express, db: Db, { access }: SiteOperations, ai: AiConfig | undefined) {
  app.get("/api/ai/status", (_req, res) => {
    res.json(ai ? { enabled: true, model: ai.model, remaining: Math.max(0, ai.monthlyLimit - used(db)) } : { enabled: false });
  });
  app.post("/api/sites/:siteId/ai/expense-description", async (req, res, next) => {
    try {
      access(req, true, true);
      if (!ai) throw new HttpError(404, "AI 기능이 꺼져 있습니다.");
      const text = maskForAi(z.object({ text: z.string().trim().min(1, "내용을 입력한 뒤 제안을 받으세요.").max(200) }).strict().parse(req.body).text);
      db.exec("BEGIN IMMEDIATE");
      try {
        if (used(db) >= ai.monthlyLimit) throw new HttpError(429, "이번 달 AI 요청 한도를 다 썼습니다.");
        db.prepare("INSERT INTO ai_usage VALUES(?,1) ON CONFLICT(month) DO UPDATE SET requests=requests+1").run(month());
        db.exec("COMMIT");
      } catch (e) { db.exec("ROLLBACK"); throw e; }
      audit(db, req.session.userId!, String(req.params.siteId), "ai.expense_description", ai.model);
      let suggestion: string | null;
      try { suggestion = await ai.suggest(text); }
      catch (e) {
        if (e instanceof Anthropic.RateLimitError) throw new HttpError(503, "AI 서비스가 바쁩니다. 잠시 뒤 다시 시도하세요.");
        if (e instanceof Anthropic.AuthenticationError) throw new HttpError(503, "AI 인증 정보를 확인하세요(.env).");
        throw new HttpError(502, "AI 제안을 받지 못했습니다. 입력은 그대로입니다.");
      }
      if (!suggestion) throw new HttpError(422, "AI가 이 문구에 제안을 하지 않았습니다.");
      res.json({ suggestion, sent: text, model: ai.model });
    } catch (err) { next(err); }
  });
}
