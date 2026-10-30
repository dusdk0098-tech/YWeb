import type { Db } from "./db.js";
import type { EducationInput } from "./education-validation.js";
import type { CatalogSnapshot } from "./education-catalog-model.js";
import { journalHash } from "./daily-journal-sources.js";
import { HttpError } from "./site-operations.js";
export type CatalogProvenance = {
  snapshot: CatalogSnapshot;
  hash: string;
  modified: boolean;
};
export function educationCatalogSource(
  db: Db,
  id: string,
  details: EducationInput,
): CatalogProvenance | null {
  const row = db
    .prepare(
      "SELECT l.*,s.site_id FROM education_catalog_links l JOIN education_sessions s ON s.id=l.session_id WHERE l.session_id=?",
    )
    .get(id) as
    | {
        catalog_id: string;
        source_snapshot: string;
        source_hash: string;
        site_id: string;
      }
    | undefined;
  if (!row) return null;
  const snapshot = JSON.parse(row.source_snapshot) as CatalogSnapshot;
  if (
    journalHash(snapshot) !== row.source_hash ||
    snapshot.id !== row.catalog_id ||
    snapshot.site.id !== row.site_id
  )
    throw new HttpError(409, "교육일지의 게시 출처가 일치하지 않습니다.");
  const b = snapshot.body;
  return {
    snapshot,
    hash: row.source_hash,
    modified:
      details.title !== b.title ||
      details.courseLabel !== b.categoryLabel ||
      details.objectives !== b.objectives ||
      details.contents !== b.contents,
  };
}
export function copyEducationCatalogSource(db: Db, from: string, to: string) {
  db.prepare(
    "INSERT INTO education_catalog_links(session_id,catalog_id,source_snapshot,source_hash) SELECT ?,catalog_id,source_snapshot,source_hash FROM education_catalog_links WHERE session_id=?",
  ).run(to, from);
}
