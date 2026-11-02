import type { Db } from "./db.js";
import { openSecret, sealSecret } from "./local-admin.js";
// 외부 접속 마법사 상태 (specs/001-easy-domain-setup/data-model.md). Separate from public_access so "처음부터" never
// touches the applied settings. The Cloudflare API token is sealed like the tunnel token and never sent back.
export type SetupMode = "direct" | "tunnel";
export type CheckStatus = "ok" | "todo" | "unknown" | "running";
// ok = 완료, todo = 아직 안 됨, unknown = 확인 불가, running = 확인 중. reason is one Korean sentence for the screen.
export type CheckResult = { status: CheckStatus; reason: string; current?: string; expected?: string; at: string };
export type Setup = {
  hasDomain: boolean | null; canRouter: boolean | null; recommended: SetupMode | null; chosen: SetupMode | null;
  cfToken?: string; cfHint: string | null; cfZoneId: string | null; cfAccountId: string | null; cfTunnelId: string | null;
  domain: string; email: string; agreeTos: boolean; checks: Record<string, CheckResult>;
};
export function migratePublicSetup(db: Db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS public_setup(id INTEGER PRIMARY KEY CHECK(id=1),has_domain INTEGER CHECK(has_domain IN (0,1)),can_router INTEGER CHECK(can_router IN (0,1)),
  recommended TEXT CHECK(recommended IN ('direct','tunnel')),chosen TEXT CHECK(chosen IN ('direct','tunnel')),
  cf_iv TEXT,cf_tag TEXT,cf_cipher TEXT,cf_hint TEXT,cf_zone_id TEXT,cf_account_id TEXT,cf_tunnel_id TEXT,
  checks_json TEXT NOT NULL DEFAULT '{}',updated_by TEXT NOT NULL REFERENCES users(id),updated_at TEXT NOT NULL);
PRAGMA user_version=74`);
}
// 75: what the wizard is filling in, kept here so the applied settings in public_access change only at "적용".
export function migratePublicSetupForm(db: Db) {
  // Repeatable like every step of the ladder (a rewound database replays it with the columns already there).
  const cols = new Set((db.prepare("PRAGMA table_info(public_setup)").all() as { name: string }[]).map((c) => c.name));
  if (!cols.has("domain")) db.exec("ALTER TABLE public_setup ADD COLUMN domain TEXT NOT NULL DEFAULT ''");
  if (!cols.has("acme_email")) db.exec("ALTER TABLE public_setup ADD COLUMN acme_email TEXT NOT NULL DEFAULT ''");
  if (!cols.has("tos_agreed")) db.exec("ALTER TABLE public_setup ADD COLUMN tos_agreed INTEGER NOT NULL DEFAULT 0 CHECK(tos_agreed IN (0,1))");
  db.exec("PRAGMA user_version=75");
}
type Row = {
  has_domain: number | null; can_router: number | null; recommended: SetupMode | null; chosen: SetupMode | null;
  cf_iv: string | null; cf_tag: string | null; cf_cipher: string | null; cf_hint: string | null;
  cf_zone_id: string | null; cf_account_id: string | null; cf_tunnel_id: string | null; checks_json: string;
  domain: string; acme_email: string; tos_agreed: number;
};
const bool = (v: number | null) => (v === null ? null : !!v);
export function readSetup(db: Db, secret: string): Setup | null {
  const r = db.prepare("SELECT * FROM public_setup WHERE id=1").get() as Row | undefined;
  if (!r) return null;
  const cfToken = r.cf_iv && r.cf_tag && r.cf_cipher ? openSecret(secret, { iv: r.cf_iv, tag: r.cf_tag, cipher: r.cf_cipher }) : undefined;
  return {
    hasDomain: bool(r.has_domain), canRouter: bool(r.can_router), recommended: r.recommended, chosen: r.chosen,
    cfToken, cfHint: r.cf_hint, cfZoneId: r.cf_zone_id, cfAccountId: r.cf_account_id, cfTunnelId: r.cf_tunnel_id,
    domain: r.domain, email: r.acme_email, agreeTos: !!r.tos_agreed,
    checks: JSON.parse(r.checks_json) as Record<string, CheckResult>,
  };
}
// cfToken: undefined keeps the stored token, null removes it (and what was found with it), a string replaces it.
export type SetupPatch = Partial<Omit<Setup, "cfToken" | "cfHint">> & { cfToken?: string | null };
export function writeSetup(db: Db, secret: string, userId: string, patch: SetupPatch) {
  const old = readSetup(db, secret);
  const next = { ...(old ?? { hasDomain: null, canRouter: null, recommended: null, chosen: null, cfHint: null, cfZoneId: null, cfAccountId: null, cfTunnelId: null, domain: "", email: "", agreeTos: false, checks: {} }), ...patch };
  const sealed = typeof patch.cfToken === "string" ? sealSecret(secret, patch.cfToken) : null;
  const clearCf = patch.cfToken === null;
  const keep = !clearCf && !sealed;
  const prev = keep ? (db.prepare("SELECT cf_iv,cf_tag,cf_cipher,cf_hint FROM public_setup WHERE id=1").get() as Pick<Row, "cf_iv" | "cf_tag" | "cf_cipher" | "cf_hint"> | undefined) : undefined;
  const cf = sealed ? { ...sealed, hint: "…" + (patch.cfToken as string).slice(-4) } : prev ? { iv: prev.cf_iv, tag: prev.cf_tag, cipher: prev.cf_cipher, hint: prev.cf_hint } : { iv: null, tag: null, cipher: null, hint: null };
  if (clearCf) Object.assign(next, { cfZoneId: null, cfAccountId: null, cfTunnelId: null });
  const n = (v: boolean | null) => (v === null ? null : Number(v));
  db.prepare(`INSERT INTO public_setup(id,has_domain,can_router,recommended,chosen,cf_iv,cf_tag,cf_cipher,cf_hint,cf_zone_id,cf_account_id,cf_tunnel_id,
    checks_json,updated_by,updated_at,domain,acme_email,tos_agreed) VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET has_domain=excluded.has_domain,
    can_router=excluded.can_router,recommended=excluded.recommended,chosen=excluded.chosen,cf_iv=excluded.cf_iv,cf_tag=excluded.cf_tag,cf_cipher=excluded.cf_cipher,
    cf_hint=excluded.cf_hint,cf_zone_id=excluded.cf_zone_id,cf_account_id=excluded.cf_account_id,cf_tunnel_id=excluded.cf_tunnel_id,checks_json=excluded.checks_json,
    updated_by=excluded.updated_by,updated_at=excluded.updated_at,domain=excluded.domain,acme_email=excluded.acme_email,tos_agreed=excluded.tos_agreed`)
    .run(n(next.hasDomain), n(next.canRouter), next.recommended, next.chosen, cf.iv, cf.tag, cf.cipher, cf.hint,
      next.cfZoneId, next.cfAccountId, next.cfTunnelId, JSON.stringify(next.checks), userId, new Date().toISOString(),
      next.domain, next.email, Number(next.agreeTos));
}
export function mergeCheck(db: Db, secret: string, userId: string, step: string, result: CheckResult) {
  const checks = { ...(readSetup(db, secret)?.checks ?? {}), [step]: result };
  writeSetup(db, secret, userId, { checks });
}
export const clearSetup = (db: Db) => void db.prepare("DELETE FROM public_setup WHERE id=1").run();
