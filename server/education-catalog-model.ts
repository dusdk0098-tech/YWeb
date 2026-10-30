import { z } from "zod";
import type { Db } from "./db.js";
import { HttpError } from "./site-operations.js";
import { journalHash } from "./daily-journal-sources.js";
export const catalogBody = z
  .object({
    title: z.string().trim().min(1).max(200),
    categoryLabel: z.string().trim().max(200),
    objectives: z.string().trim().max(5000),
    contents: z.string().trim().max(10000),
    referenceNote: z.string().trim().max(2000),
  })
  .strict();
export type CatalogBody = z.infer<typeof catalogBody>;
export type CatalogSnapshot = {
  id: string;
  version: number;
  site: { id: string; name: string };
  parentId: string | null;
  body: CatalogBody;
  publishedBy: { id: string; name: string };
  publishedAt: string;
};
export type CatalogRow = {
  id: string;
  site_id: string;
  parent_id: string | null;
  body: string;
  status: "draft" | "published";
  version: number;
  published_snapshot: string | null;
  published_hash: string | null;
  created_at: string;
  updated_at: string;
};
export function getCatalog(db: Db, site: string, id: string) {
  const row = db
    .prepare("SELECT * FROM education_catalog WHERE site_id=? AND id=?")
    .get(site, id) as CatalogRow | undefined;
  if (!row) throw new HttpError(404, "자체 교육내용을 찾을 수 없습니다.");
  return row;
}
export function catalogRecord(db: Db, row: CatalogRow) {
  return {
    ...row,
    revisionNote: db
      .prepare(
        "SELECT reason,actor_id,actor_name,at FROM education_catalog_revision_notes WHERE catalog_id=?",
      )
      .get(row.id) as
      | { reason: string; actor_id: string; actor_name: string; at: string }
      | undefined,
    body: JSON.parse(row.body) as CatalogBody,
    published_snapshot: row.published_snapshot
      ? (JSON.parse(row.published_snapshot) as CatalogSnapshot)
      : null,
    successorId:
      (
        db
          .prepare(
            "SELECT id FROM education_catalog WHERE parent_id=? AND site_id=?",
          )
          .get(row.id, row.site_id) as { id: string } | undefined
      )?.id || null,
  };
}
export function publishedCatalog(row: CatalogRow) {
  if (
    row.status !== "published" ||
    !row.published_snapshot ||
    !row.published_hash
  )
    throw new HttpError(409, "게시된 자체 교육내용 버전을 선택하세요.");
  const snapshot = JSON.parse(row.published_snapshot) as CatalogSnapshot;
  if (
    journalHash(snapshot) !== row.published_hash ||
    snapshot.id !== row.id ||
    snapshot.version !== row.version ||
    snapshot.site.id !== row.site_id
  )
    throw new HttpError(409, "교육내용 게시본 해시/출처가 일치하지 않습니다.");
  return snapshot;
}
