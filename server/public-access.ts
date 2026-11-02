import type { Express, Request } from "express";
import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import { isLocalRequest, openSecret, sealSecret } from "./local-admin.js";
import { resolveHost } from "./public-checks.js";
// Self-hosting (사용자 결정 2026-10-31): the installed PC serves the app to phones and other PCs under a domain the owner bought.
// "direct" = this PC answers on 80/443 and gets/renews a Let's Encrypt certificate itself (owner points DNS + forwards ports);
// "tunnel" = Cloudflare Tunnel (cloudflared, token from the Cloudflare dashboard; no port forwarding, DNS set by Cloudflare).
// Settings change only from a browser on this PC and apply at the next start.
export type PublicMode = "off" | "direct" | "tunnel";
export type PublicSettings = { mode: PublicMode; domain: string; email: string; tosAgreedAt: string | null; tunnelToken?: string; tunnelHint: string | null };
// What the running process actually did with the settings it started with (shown on the settings screen).
// launcher: started by start.cmd, which restarts the app when it exits with code 75 (the wizard's "다시 시작해 적용").
export type PublicRuntime = { mode: PublicMode; origin?: string; state: string; detail?: string; certNotAfter?: string; launcher?: boolean };
export function migratePublicAccess(db: Db) {
  db.exec(`
 CREATE TABLE IF NOT EXISTS public_access(id INTEGER PRIMARY KEY CHECK(id=1),mode TEXT NOT NULL CHECK(mode IN ('off','direct','tunnel')),domain TEXT NOT NULL,acme_email TEXT NOT NULL,
  tos_agreed_at TEXT,tunnel_iv TEXT,tunnel_tag TEXT,tunnel_cipher TEXT,tunnel_hint TEXT,updated_by TEXT NOT NULL REFERENCES users(id),updated_at TEXT NOT NULL);
 PRAGMA user_version=70;
`);
}
// A registrable public hostname: no IPs, no localhost, no wildcard — Let's Encrypt and Cloudflare both need a real name.
export const domainSchema = z.string().trim().toLowerCase().max(253)
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/, "도메인 형식을 확인하세요(예: safety.example.com).");
type Row = { mode: PublicMode; domain: string; acme_email: string; tos_agreed_at: string | null; tunnel_iv: string | null; tunnel_tag: string | null; tunnel_cipher: string | null; tunnel_hint: string | null };
export function readPublicSettings(db: Db, secret: string): PublicSettings {
  const r = db.prepare("SELECT * FROM public_access WHERE id=1").get() as Row | undefined;
  if (!r) return { mode: "off", domain: "", email: "", tosAgreedAt: null, tunnelHint: null };
  const tunnelToken = r.tunnel_iv && r.tunnel_tag && r.tunnel_cipher ? openSecret(secret, { iv: r.tunnel_iv, tag: r.tunnel_tag, cipher: r.tunnel_cipher }) : undefined;
  return { mode: r.mode, domain: r.domain, email: r.acme_email, tosAgreedAt: r.tos_agreed_at, tunnelToken, tunnelHint: r.tunnel_hint };
}
export const publicOrigin = (s: PublicSettings) => (s.mode !== "off" && s.domain ? `https://${s.domain}` : undefined);
const input = z.object({
  mode: z.enum(["off", "direct", "tunnel"]), domain: z.union([z.literal(""), domainSchema]),
  email: z.union([z.literal(""), z.email().max(254)]), agreeTos: z.boolean(), tunnelToken: z.string().trim().max(4000),
}).strict();
export function registerPublicAccess(app: Express, db: Db, runtime: PublicRuntime, secret: string) {
  const signedIn = (req: Request) => { if (!req.session.userId) throw new HttpError(401, "로그인이 필요합니다."); return req.session.userId; };
  // Any signed-in user: where phones should open links (TBM QR). Uses what is running now, not unsaved settings.
  app.get("/api/public-origin", (req, res, next) => {
    try { signedIn(req); res.json({ origin: runtime.origin ?? null }); } catch (err) { next(err); }
  });
  app.get("/api/public-access", async (req, res, next) => {
    try {
      signedIn(req);
      const s = readPublicSettings(db, secret), local = isLocalRequest(req);
      let resolved: string[] | null = null;
      if (local && s.domain) resolved = await resolveHost(s.domain);
      res.json({
        canManage: local, runtime,
        settings: local ? { mode: s.mode, domain: s.domain, email: s.email, tosAgreed: !!s.tosAgreedAt, tunnelHint: s.tunnelHint } : null,
        restartNeeded: (publicOrigin(s) ?? null) !== (runtime.origin ?? null) || s.mode !== runtime.mode,
        dns: resolved,
      });
    } catch (err) { next(err); }
  });
  app.put("/api/public-access", (req, res, next) => {
    try {
      const userId = signedIn(req);
      if (!isLocalRequest(req)) throw new HttpError(403, "외부 접속 설정은 이 앱이 설치된 PC에서 직접 접속했을 때만 바꿀 수 있습니다.");
      const v = input.parse(req.body), old = readPublicSettings(db, secret);
      if (v.mode !== "off" && !v.domain) throw new HttpError(400, "도메인을 입력하세요.");
      if (v.mode === "direct" && (!v.email || !v.agreeTos)) throw new HttpError(400, "직접 연결은 인증서 발급용 이메일과 Let's Encrypt 이용약관 동의가 필요합니다.");
      if (v.mode === "tunnel" && !v.tunnelToken && !old.tunnelToken) throw new HttpError(400, "Cloudflare 터널 토큰을 입력하세요.");
      const token = v.tunnelToken ? sealSecret(secret, v.tunnelToken) : null;
      db.prepare(`INSERT INTO public_access VALUES(1,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET mode=excluded.mode,domain=excluded.domain,acme_email=excluded.acme_email,
        tos_agreed_at=excluded.tos_agreed_at,tunnel_iv=coalesce(excluded.tunnel_iv,tunnel_iv),tunnel_tag=coalesce(excluded.tunnel_tag,tunnel_tag),
        tunnel_cipher=coalesce(excluded.tunnel_cipher,tunnel_cipher),tunnel_hint=coalesce(excluded.tunnel_hint,tunnel_hint),updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
        .run(v.mode, v.domain, v.email, v.agreeTos ? (old.tosAgreedAt ?? new Date().toISOString()) : null, token?.iv ?? null, token?.tag ?? null, token?.cipher ?? null,
          v.tunnelToken ? "…" + v.tunnelToken.slice(-4) : null, userId, new Date().toISOString());
      res.json({ ok: true, restartNeeded: true });
    } catch (err) { next(err); }
  });
}
