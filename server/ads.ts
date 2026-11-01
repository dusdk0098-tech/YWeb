import type { Express } from "express";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
// 광고 (docs/UI_REDESIGN_PLAN.md 결정 6): the developer's own ads, served to installs of this open-source app.
// The feed is a JSON file plus images in a separate public repository (GitHub Pages). This server — never the
// browser — fetches it once a day, validates it, keeps a copy under the data folder (so the last ads show offline)
// and serves text, link and image from /api/ads, which keeps the CSP as strict as it is. Only text, a link and an
// image can come from the feed: no HTML, no scripts. The request to the feed carries no site or account data,
// and nothing is counted here: a click opens the link in a new tab, and any counting is the advertiser's own.
// There is no switch in the app (the developer's decision, 2026-11-02): ADS_FEED_URL only changes the feed address.
export const DEFAULT_ADS_FEED = "https://dusdk0098-tech.github.io/yweb-ads/ads.json";
export type AdsConfig = { feedUrl: string; dir: string; fetch?: typeof fetch; intervalMs?: number };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const adsFeed = z.object({
  version: z.literal(1),
  ads: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]{1,40}$/),
    title: z.string().trim().min(1).max(60),
    text: z.string().trim().max(140).default(""),
    url: z.string().url().max(300).refine((u) => u.startsWith("https://"), "https only"),
    image: z.string().regex(/^[a-z0-9-]+\.(png|jpg|jpeg)$/).optional(), // next to ads.json in the feed repository
    from: date.optional(),
    to: date.optional(),
  }).strict()).max(20),
}).strict();
export type AdsFeed = z.infer<typeof adsFeed>;
type Cached = { feed: AdsFeed; fetchedAt: string; images: Record<string, { type: string; file: string }> };
export function migrateAds(db: Db) {
  // ads_settings stays for schema continuity (73); nothing reads it since the in-app switch was removed.
  db.exec(`
CREATE TABLE IF NOT EXISTS ads_settings(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),updated_at TEXT NOT NULL,updated_by TEXT NOT NULL);
PRAGMA user_version=73`);
}
const MAX_FEED_BYTES = 64 * 1024, MAX_IMAGE_BYTES = 300 * 1024, IMAGE_TYPES = ["image/png", "image/jpeg"];
async function readBody(res: Response, max: number) {
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > max) throw new Error(`응답이 ${max} 바이트를 넘습니다.`);
  return bytes;
}
export function registerAds(app: Express, db: Db, config: AdsConfig | undefined) {
  let cache: Cached | null = null, lastError = "";
  const dir = config?.dir ?? "", doFetch = config?.fetch ?? globalThis.fetch;
  if (config) {
    try {
      if (existsSync(join(dir, "feed.json"))) cache = JSON.parse(readFileSync(join(dir, "feed.json"), "utf8")) as Cached;
    } catch { cache = null; }
  }
  // Fetch the feed and its images, replacing the cache only when everything validated; a failure keeps the last copy.
  async function refresh() {
    if (!config) return;
    try {
      const headers = { "user-agent": "YWeb-ads/1", accept: "application/json" };
      const res = await doFetch(config.feedUrl, { headers, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const feed = adsFeed.parse(JSON.parse((await readBody(res, MAX_FEED_BYTES)).toString("utf8")));
      mkdirSync(dir, { recursive: true });
      const base = config.feedUrl.replace(/[^/]*$/, ""), images: Cached["images"] = {};
      for (const ad of feed.ads) {
        if (!ad.image) continue;
        const r = await doFetch(base + ad.image, { headers: { "user-agent": "YWeb-ads/1" }, signal: AbortSignal.timeout(10_000) });
        const type = (r.headers.get("content-type") || "").split(";")[0].trim();
        if (!r.ok || !IMAGE_TYPES.includes(type)) throw new Error(`이미지 ${ad.image}: 형식 또는 응답 오류`);
        const bytes = await readBody(r, MAX_IMAGE_BYTES), file = `img-${ad.id}.${type === "image/png" ? "png" : "jpg"}`;
        writeFileSync(join(dir, file), bytes);
        images[ad.id] = { type, file };
      }
      cache = { feed, fetchedAt: new Date().toISOString(), images };
      writeFileSync(join(dir, "feed.json"), JSON.stringify(cache));
      lastError = "";
    } catch (e) { lastError = (e as Error).message; }
  }
  if (config) {
    void refresh();
    const timer = setInterval(() => void refresh(), config.intervalMs ?? 24 * 3600_000);
    timer.unref();
  }
  const current = () => {
    const today = new Date().toISOString().slice(0, 10);
    return (cache?.feed.ads ?? []).filter((a) => (!a.from || a.from <= today) && (!a.to || today <= a.to));
  };
  app.get("/api/ads", (req, res) => {
    if (!req.session.userId) throw new HttpError(401, "로그인이 필요합니다.");
    const on = !!config;
    res.json({
      enabled: on,
      fetchedAt: cache?.fetchedAt ?? null,
      lastError: lastError || null,
      ads: on ? current().map((a) => ({ id: a.id, title: a.title, text: a.text, url: a.url, image: !!cache?.images[a.id] })) : [],
    });
  });
  app.get("/api/ads/image/:id", (req, res) => {
    if (!req.session.userId) throw new HttpError(401, "로그인이 필요합니다.");
    const img = cache?.images[String(req.params.id)];
    if (!img || !/^[a-z0-9-]+$/.test(String(req.params.id)) || !config) throw new HttpError(404, "광고 이미지가 없습니다.");
    res.setHeader("content-type", img.type);
    res.setHeader("cache-control", "private, max-age=3600");
    res.send(readFileSync(join(dir, img.file)));
  });
  return { refresh };
}
