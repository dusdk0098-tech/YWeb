import type { catalogRecord } from "../server/education-catalog-model";
export type CatalogRecord = ReturnType<typeof catalogRecord>;
export type { CatalogBody } from "../server/education-catalog-model";
export const catalogWarning =
  "권리 있는 내용을 사용자가 직접 작성하는 자체 교육내용입니다. 법정 과정·기준 시간·교육 이수·수료증 인증이 아닙니다. 기본 제공 과정 내용은 없습니다.";
