import type { CatalogProvenance } from "../server/education-catalog-source";
import type { EducationInput } from "./education-types";
export function EducationCatalogProvenance({
  source,
  current,
  dirty,
}: {
  source: CatalogProvenance;
  current: EducationInput;
  dirty: boolean;
}) {
  const original = source.snapshot,
    b = original.body,
    modified =
      current.title.trim() !== b.title ||
      current.courseLabel.trim() !== b.categoryLabel ||
      current.objectives.trim() !== b.objectives ||
      current.contents.trim() !== b.contents;
  return (
    <aside>
      <h3>고정 게시 출처 · 복사된 내용은 편집 가능</h3>
      <p>
        {original.body.title} · {original.id} v{original.version} ·{" "}
        {source.hash}
      </p>
      <p>
        {modified
          ? "현재 작성 내용은 출처에서 수정되었습니다."
          : "현재 제목/과정표시/목표/내용은 이 출처와 같습니다."}
        {dirty ? " 미저장 입력 기준이며 저장 후 서버에서 다시 계산합니다." : ""}{" "}
        불변 출처가 현재 내용의 동일성/법적 적합성을 보증하지 않습니다.
      </p>
      <details>
        <summary>원래 게시된 내용 보기</summary>
        <p>{b.categoryLabel}</p>
        <p>{b.objectives}</p>
        <pre>{b.contents}</pre>
        <p>수기 참고: {b.referenceNote}</p>
        <p>
          게시 계정 {original.publishedBy.name} ({original.publishedBy.id}) ·{" "}
          {original.publishedAt}
        </p>
      </details>
    </aside>
  );
}
