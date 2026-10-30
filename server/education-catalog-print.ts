import { escapeHtml as h } from "./print.js";
import type {
  CatalogSnapshot,
  CatalogBody,
} from "./education-catalog-model.js";
import type { CatalogProvenance } from "./education-catalog-source.js";
export function catalogProvenanceHtml(
  source: CatalogProvenance | null | undefined,
) {
  if (!source) return "<p>자체 교육내용 게시 출처 미기록 (직접 작성 일지)</p>";
  const s = source.snapshot;
  return `<section><h2>고정 게시 출처</h2><p>${h(s.body.title)} · ${h(s.id)} v${s.version} · ${h(source.hash)}</p><p>${source.modified ? "현재 일지의 제목/과정표시/목표/내용은 출처에서 수정되었습니다." : "현재 일지의 제목/과정표시/목표/내용은 이 게시 출처와 같습니다."} 출처 불변이 현재 작성내용의 동일성·법적 적합성을 보증하지 않습니다.</p><details><summary>원래 게시 교육내용</summary><p>${h(s.body.categoryLabel)}</p><p>${h(s.body.objectives)}</p><p>${h(s.body.contents)}</p><p>수기 참고 메모: ${h(s.body.referenceNote)}</p></details><p>게시 계정 ${h(s.publishedBy.name)} (${h(s.publishedBy.id)}) · ${h(s.publishedAt)}</p></section>`;
}
export function printCatalog(
  body: CatalogBody,
  snapshot: CatalogSnapshot | null,
  hash: string | null,
) {
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><title>자체 교육내용</title><link rel="stylesheet" href="/print.css"><main><h1>자체 교육내용 ${snapshot ? "고정 게시본" : "초안"}</h1><p>사용자가 권리 있는 내용을 직접 작성하는 빈 카탈로그입니다. 법정 과정/이수시간/수료증·교육 이수 인정이 아닙니다.</p><h2>${h(body.title)}</h2><p>자체 분류 ${h(body.categoryLabel)}</p><h3>목표</h3><p>${h(body.objectives)}</p><h3>내용</h3><p>${h(body.contents)}</p><p>수기 참고 ${h(body.referenceNote)}</p>${snapshot ? `<p>${h(snapshot.id)} v${snapshot.version} · ${h(snapshot.site.name)} · ${h(snapshot.publishedBy.name)} (${h(snapshot.publishedBy.id)}) · ${h(snapshot.publishedAt)} · ${h(hash)}</p>` : ""}</main></html>`;
}
