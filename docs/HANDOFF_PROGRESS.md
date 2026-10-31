# 인계 이후 진행 기록

인계문서(`docs/claude-handoff/`, PR #5)의 요구사항 ID 기준으로, 인계 뒤 구현·검증한 범위와 남은 결정을 기록한다. 원앱 기능 대조 세부는 [SC_COMPARISON.md](SC_COMPARISON.md).

**기준:** main `7780f2d`에서 PR #1~#4를 합친 `integrate/baseline`(PR #6) 위에 PR #7~#17을 순서대로 쌓음. 기록 시점 head `58e81df`, 모두 미병합. 병합 순서 #6 → #7 → … → #17.

## 실행한 검사

| 시점(head) | 환경 | 명령 | 결과 |
|---|---|---|---|
| `58e81df` | Windows 11 Pro 10.0.26200, Node 24.14.1 | `npm run check` (lint·typecheck·test·build) | 테스트 372/372 통과 |
| `58e81df` | 동일, Chromium 149.0.7827.55 (`CHROMIUM_PATH`) | `npm run test:e2e` | 28/28 통과 |
| 각 PR | 동일 | 임시 DB(`DB_PATH`·`PORT=3100`) 서버 + 앱 내 브라우저 수동 확인 | PR 본문에 시나리오별 기록 |

- E2E: 이 PC의 Playwright가 찾는 브라우저 빌드(1248)가 없어 설치돼 있던 Chromium 1228을 `CHROMIUM_PATH`로 지정했다. 지정 없이는 28개 모두 실행 파일 없음으로 실패한다(환경 문제).
- 실행하지 않음: Linux CI, 알PDF 실제 출력, Android 에뮬레이터·실기기, 독립 보안검토, 사용자 UAT.

## 요구사항별 진행

| ID | 이번 범위 | PR | 남은 것 |
|---|---|---|---|
| OPS-01 / 단계1 | PR #1과 감사 수정 통합, Windows 시험 실패 2건(백업 권한·symlink EPERM)을 환경 제약으로 분류해 시험에서 처리, ZIP 경로 검증은 PR #1의 엄격한 쪽 유지 | #6 | SEC-LOCAL-01(기존 폴더 권한) — 권한 변경은 승인 필요라 미착수 |
| UX-OTHER / 단계1 오류 표시 | 400 응답의 한국어 칸별 사유를 공통 오류 문구에 표시 | #14 | — |
| UX-SC / SC-01 | 원본 9개 화면 대조표, 9개 법정 항목 채우기, 항목별 상세, 현장 설정, 인건비 구분·조회, 월마감 대시보드(다음 작업 포함), 연속 입력·복사·중복 경고, 출력 전 확인, 항목별 추가필드 | #7~#13, #16 | 아래 "결정 필요" |
| MT-01 | 현장 전체 후속조치 보드(내 담당·미확인 필터, 기한 표시) | #15 | 실제 서명·법적 역할 |
| 회귀 | 위 변경으로 생긴 E2E 실패 4건 수정 | #17 | — |
| MOB-01 1단계 / TBM 링크·QR 참여 | 이름+생년월일(해시) 본인 확인, QR 이미지(`qrcode` 1.5.4, 승인), 2시간 만료·폐기·TBM 내용 결속 링크, 로그인 없는 `/join`, 추가 전용 참여 기록, 명부 상태 자동 변경 없음, 시도 제한 (schema 63) | 이 PR | 서명·위치 동의, 운영 배포(현재 loopback 전용이라 휴대폰 접속 불가), 실기기 |
| N-01 / 사진 보드 1단계 | 메뉴 "사진 보드": 여러 장 업로드(원본 보존·다운로드만, 브라우저 표시본만 표시), 포함/제외·순서·90° 회전·설명·원형 강조(클릭 추가, 화살표 1%/Shift 10% 이동, +/− 크기, Delete, 색 3종), 실행 취소/다시 실행, 장면 저장(schema 62, 버전 충돌 409), 화면과 같은 그리기로 PNG 저장. 보드당 40장 | 이 PR | PDF 사진대지 출력, 크롭·확대, 폴더 입력, TSV caption, 모바일 터치 조작, 실제 사진·대용량 메모리 확인 |
| N-01 일부 / SC 사진대지 | 정책 A안 승인([PHOTO_BOARD_POLICY_PROPOSAL.md](PHOTO_BOARD_POLICY_PROPOSAL.md)). 브라우저 표시본(EXIF 제거)만 표시, 원본은 다운로드만. 분류4종·촬영일·내용·포함, 분류별 1쪽 2칸 인쇄, 출력 전 확인 경고 | 이 PR | 독립 사진 보드(N: 원형 강조·undo·PNG), 회전·순서, 실제 8방향 EXIF 사진·알PDF·모바일 확인 |
| UX-SC / 마감 차단 | 사용자 결정에 따라 출력 전 확인 오류가 있으면 서버가 마감 거부(409), 화면 마감 버튼 비활성. 기존 마감 시험은 합성 현장 설정을 넣는 공통 도우미(`tests/fixtures/cost-close-ready.ts`)로 유지 | 이 PR | — |

DB 버전: 56 → 62 (`cost_period_settings`, `cost_expense_labor`, `cost_expense_details`, `cost_evidence_displays`, `education_catalog_reviews`, `photo_boards`·`photo_board_photos`) → 63 (`worker_identities`, `activity_invitations`, `participation_events`). 앞의 세 테이블 모두 지출 행·마감본 바이트를 바꾸지 않는 옆 테이블이며, 작성 중 원장에서만 쓰기가 가능하다(트리거).

## 결정 필요 (구현 보류)

1. **법정 서식 출력** — A안 승인, 1·2단계(표지·집계표·갑·총괄·을·항목 1~9 상세) 구현. 원본 셀 채움 생성기와 합성 입력 1회 대조: 법정 서식 값 일치(표지 날짜 표시 형식만 다름, LEGAL_FORMS_PROPOSAL.md). 남은 것: 알PDF 육안 확인. — 원본 xlsm 양식과의 동등성 기준(문서 순서·쪽 나눔·셀 위치·허용 차이)이 필요하다. 원본 내역집계표의 8번(본사) 열 누락이 의도인지도 확인 필요. 기준안: [LEGAL_FORMS_PROPOSAL.md](LEGAL_FORMS_PROPOSAL.md) (미승인).
2. **교육·일지 재설계** — A안(화면 흐름)과 B안(교육내용 검수 기록, schema 61, 관리자 기록·미검수 시 경고) 구현. — 인계문서의 제안은 현재 v1에 없는 메타데이터(적용대상·권리 검수)나 전면 화면 재설계를 수반한다. 재설계안: [EDU_JOURNAL_REDESIGN_PROPOSAL.md](EDU_JOURNAL_REDESIGN_PROPOSAL.md) (미승인).
3. **SEC-LOCAL-01** — A안(읽기 전용 점검·경고)과 B안(운영자 실행 권한 정리 명령·umask 077) 구현: [SEC_LOCAL_01_PROPOSAL.md](SEC_LOCAL_01_PROPOSAL.md). 실제 운영 PC 적용·재검증은 운영자 몫.

## 남은 영역 사양안

기타 항목 승인(2026-10-31)에 따라 MOB-01·P-01·SC-04·오프라인·WEB-01·P-02의 첫 수직 구현 단위와 결정 필요 값을 [REMAINING_AREAS_SPEC.md](REMAINING_AREAS_SPEC.md)에 정리했다. 결정이 채워지는 영역부터 구현한다.
