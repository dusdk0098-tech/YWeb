import type { CostEvidence } from "./cost-evidence-types";
export function CostEvidenceWarnings({ evidence }: { evidence: CostEvidence }) {
  const w = evidence.warnings;
  return <section><h3>현재 참조 상태 (적격 판정 아님)</h3>
    <p>미연결 활성 지출 {w.activeExpensesWithoutLink.length}개 · 연결 뒤 행 변경 {w.changedLinks.length}개 · 취소행 연결 {w.cancelledLinks.length}개 · 미연결 원본 {w.unlinkedFiles.length}개</p>
    <p>취소/복원/수정/분할/되돌리기는 연결을 자동 옮기거나 재확인하지 않습니다. 분할 자식은 직접 선택해야 합니다. 변경된 행의 현재 출처를 기록하려면 파일의 연결목록을 명시 저장하세요. 이 기록은 검증 완료가 아닙니다.</p>
    {!!w.activeExpensesWithoutLink.length && <details><summary>미연결 활성 지출 ID</summary><p>{w.activeExpensesWithoutLink.join(" · ")}</p></details>}
  </section>;
}
