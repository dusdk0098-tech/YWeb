import type { Express } from "express";
import { z } from "zod";
import { audit, type Db } from "./db.js";
import { HttpError, type SiteOperations } from "./site-operations.js";
import { account } from "./inspection-model.js";
import { getCatalog } from "./education-catalog-model.js";
import { journalHash } from "./daily-journal-sources.js";
import { date } from "./validation.js";
// 교육 B안 (docs/EDU_JOURNAL_REDESIGN_PROPOSAL.md): append-only review records for a published content version.
// Records what a manager says they checked; no legal target/required-hours judgment is made.
// IF NOT EXISTS: older-schema test fixtures drop only the tables they know about.
export function migrateEducationReviews(db: Db) {
  db.exec(`
 CREATE TABLE IF NOT EXISTS education_catalog_reviews(id INTEGER PRIMARY KEY,catalog_id TEXT NOT NULL REFERENCES education_catalog(id),site_id TEXT NOT NULL REFERENCES sites(id),
  source_hash TEXT NOT NULL,body TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),actor_name TEXT NOT NULL,at TEXT NOT NULL,hash TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS education_catalog_reviews_catalog ON education_catalog_reviews(catalog_id,id);
 CREATE TRIGGER IF NOT EXISTS education_review_source BEFORE INSERT ON education_catalog_reviews WHEN NOT EXISTS(
  SELECT 1 FROM education_catalog WHERE id=NEW.catalog_id AND site_id=NEW.site_id AND status='published' AND published_hash=NEW.source_hash)
 BEGIN SELECT RAISE(ABORT,'Review requires the exact published content'); END;
 CREATE TRIGGER IF NOT EXISTS education_review_fixed BEFORE UPDATE ON education_catalog_reviews BEGIN SELECT RAISE(ABORT,'Review immutable'); END;
 CREATE TRIGGER IF NOT EXISTS education_review_retained BEFORE DELETE ON education_catalog_reviews BEGIN SELECT RAISE(ABORT,'Review retained'); END;
 PRAGMA user_version=61;
`);
}
const text = (max: number, label: string) => z.string().trim().min(1, `${label}을(를) 입력하세요.`).max(max, `${label}은(는) ${max}자 이하로 입력하세요.`);
export const reviewInput = z.object({
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  target: text(500, "적용대상"),
  source: text(500, "출처"),
  rightsCheckedBy: text(100, "권리 확인자"),
  rightsCheckedDate: date,
  currencyCheckedDate: date,
  note: z.string().trim().max(1000, "메모는 1000자 이하로 입력하세요.").default(""),
}).strict();
type ReviewRow = { id: number; source_hash: string; body: string; actor_name: string; at: string; hash: string };
export function catalogReviews(db: Db, catalogId: string) {
  const rows = db.prepare("SELECT id,source_hash,body,actor_name,at,hash FROM education_catalog_reviews WHERE catalog_id=? ORDER BY id DESC LIMIT 20").all(catalogId) as ReviewRow[];
  return rows.map((r) => {
    const body = JSON.parse(r.body) as Omit<z.infer<typeof reviewInput>, "sourceHash">;
    if (journalHash(body) !== r.hash) throw new HttpError(409, "검수 기록 해시가 일치하지 않습니다.");
    return { id: r.id, sourceHash: r.source_hash, ...body, actorName: r.actor_name, at: r.at };
  });
}
export function registerEducationReviews(app: Express, db: Db, { access, mutate }: SiteOperations) {
  const base = "/api/sites/:siteId/education-catalog/:id/reviews";
  app.get(base, (req, res) => {
    access(req);
    const row = getCatalog(db, String(req.params.siteId), String(req.params.id));
    if (row.status !== "published") throw new HttpError(404, "게시 교육내용을 찾을 수 없습니다.");
    res.json({ items: catalogReviews(db, row.id) });
  });
  app.post(base, (req, res) => {
    access(req, true, true);
    const v = reviewInput.parse(req.body), site = String(req.params.siteId), id = String(req.params.id);
    mutate(req, res, `education_catalog:review:${site}:${id}`, v, () => {
      const row = getCatalog(db, site, id);
      if (row.status !== "published" || row.published_hash !== v.sourceHash) throw new HttpError(409, "게시본이 바뀌었습니다. 최신 게시본을 다시 확인하세요.");
      const { sourceHash, ...body } = v, actor = account(db, req.session.userId!);
      db.prepare("INSERT INTO education_catalog_reviews(catalog_id,site_id,source_hash,body,actor_id,actor_name,at,hash) VALUES(?,?,?,?,?,?,?,?)")
        .run(id, site, sourceHash, JSON.stringify(body), actor.id, actor.name, new Date().toISOString(), journalHash(body));
      audit(db, actor.id, site, "education_catalog.reviewed", id);
      return { items: catalogReviews(db, id) };
    }, () => { access(req, true, true); getCatalog(db, site, id); });
  });
}
