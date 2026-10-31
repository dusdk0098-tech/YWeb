// MOB-01 2단계 consent text. No imports: shared with the client bundle.
// v1 wording confirmed by the owner on 2026-10-31. Changing the text needs a new version string.
export const TBM_SIGNATURE_CONSENT = {
  version: "tbm-signature-v1",
  retainYears: 3,
  text: [
    "TBM 참여 확인 서명 동의 (v1)",
    "1. 목적: 이 TBM(작업 전 안전회의)에 참여했음을 본인이 직접 확인한 서명을 남깁니다.",
    "2. 기록 항목: 명부상 이름, 서명 이미지, 기록 시각, 서명한 TBM 문서 버전.",
    "3. 보존 기간: 기록일로부터 3년 보관한 뒤 파기합니다.",
    "4. 거부: 동의하지 않으면 서명 없이 참여 의사만 기록되고, 담당자가 수기로 참석을 확인합니다.",
    "5. 이 서명은 참여 확인용이며 법적 효력이나 교육 이수를 판정하지 않습니다.",
  ].join("\n"),
};
export const SIGNATURE_MAX_BYTES = 150 * 1024;
