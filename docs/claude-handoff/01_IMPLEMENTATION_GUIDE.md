# 모듈별 구현 지도와 남은 구현 방법

상태 표기: **[목표]** 사용자 방향 / **[코드]** 원개발본에서 파일·계약 확인 / **[기록]** 과거 실행 증거 / **[미확인]** 실행 또는 결정 부족 / **[제안]** 앞으로의 설계. 이 문서는 원개발본을 읽어 재작성한 요약이며 실제자료나 비공개 원문을 포함하지 않는다.

## 1. UX/UI 원칙 — 최신 사용자 지시

- **SC는 기존 화면 구성·조작 흐름을 최대한 비슷하게 구현한다.** 화면의 정보 순서, 입력 열, 월 이동, 마감/이월, 검색·출력 진입, 경고 의미를 비교한다. 기능명만 같고 사용 방법이 전혀 다른 화면으로 바꾸지 않는다.
- **나머지 앱은 레거시 UI를 복제하지 않고 사용하기 편한 구조로 재설계한다.** 기존 기능·입력 의미·계산·저장·출력 정합성은 보존한다. 공통 현장 선택, 중복 입력 감소, 모바일 접근, 일관된 탐색을 우선한다.
- **[제안]** 공통 현장 선택을 상단에 두고 업무별 '할 일→작성→검토→기록/출력' 탐색을 제공한다. 큰 입력은 단계별 저장 가능한 섹션으로 나눈다. 이는 사용자 확정 레이아웃이 아니며 실제 업무 시나리오로 검수 후 적용한다.
- SC 비교 근거는 `audit_20261027/PEDIT-SC-source` 원소스·문서와 별도 앱 기능목록이다. 이 인계 작성에서는 원앱 실행 화면·스크린샷을 직접 검증하지 않았다. Claude는 확보한 화면만 근거로 사용하고, 없는 화면은 원소스 구조 기준 비교임을 명시한다.
- 공통 검사: 작은 화면에서 저장 버튼 접근, 입력중 탭/현장 변경의 유실 방지, 오류시 입력 보존, 키보드 순서·레이블·포커스, 긴 한글·숫자·단위, 색만으로 상태 전달 금지, 작업 완료와 처리중/응답불명을 구별.

## 2. 공통 기술 구조

**[코드]** Node24, TypeScript, React/Vite, Express, embedded SQLite. `package.json`의 실제 의존성은 argon2, express, express-rate-limit, express-session, helmet, react/react-dom, zod. 시험/개발은 TypeScript·tsx·ESLint·supertest·Playwright/Vite. `package-lock.json`을 기준으로 한다. Prisma/PostgreSQL/Next.js/외부 큐는 현재 기반이 아니며 임의 도입하지 않는다.

| 책임 | 실제 코드 | 보존 계약 |
|---|---|---|
| 요청/인증 | `server/app.ts`, `authentication.ts`, `account-session.ts`, `session-store.ts` | 쿠키·Origin/CSRF·세션 epoch/철회, 요청당 현재 권한 |
| 현장권한/변경 | `server/site-operations.ts` | 권한 확인을 성공 receipt 재생보다 먼저 수행; mutation 단일 transaction |
| DB/버전 | `server/db.ts`, `schema-version.ts`, 각 `*-schema.ts` | 현재 DB56; 미래 버전 거부; 옛 snapshot/body를 무단 backfill하지 않음 |
| 클라이언트 | `src/main.tsx`, `DomainPanels.tsx`, `api.ts`, `useDraftGuard.ts` | same-origin/CSRF; dirty/busy 이탈 보호; 409 덮어쓰기 금지 |
| 첨부 | `bounded-upload.ts`, `attachment-quota.ts`, 각 attachment 모듈 | 인증 선확인·수신후 재확인·한도·BLOB 원자 저장; UNSCANNED download-only |
| 인쇄 | 각 `*-print.ts`, `public/print.css` | escaping; 고정본은 snapshot; 현재 변경이 과거 출력에 섞이지 않음 |
| 백업 | `scripts/local-backup-cli.ts`, `local-backup.ts`, `server/recovery-gate.ts` | DB+BLOB·hash/FK·버전 확인; 복구와 단순 export 구별 |

모든 새 저장은 UUID `Idempotency-Key`, 기존 버전, 정확한 현장/문서 ID를 사용한다. 오래된 버전은409, 같은 key 다른 본문도409. 응답 불명은 재조회/동일 key 재시도이지 신규 저장 성공이 아니다. 현재 명부와 확정 당시 이름/소속을 분리한다. 서버 UTC 날짜를 현장 작업일로 임의 대체하지 않는다.

**[제안] 새 모듈 표준:** `server/<domain>-validation.ts` → schema/migration → model(업무규칙) → routes(권한/transaction) → print → `src/<Domain>Panel.tsx`/Editor/types → tests. 범용 상태엔진으로 기존 업무별 승인·보관 의미를 통합하지 않는다. 새 DB 테이블명과 API는 아래에서 제안으로 명시한 경우에만 미구현이다.

## 3. 공통 현장·명부·출역·TBM·모바일 참여

### 현재 기능

**[코드]** `users`, `sites`, `memberships`의 현장별 manager/editor/viewer; 근로자/방문자 `workers`는 로그인 계정과 다르다. `attendance`·`attendance_history`는 담당자 수기 출역이다. `(site_id, worker_id,date)` 중복 방지, 사유 있는 취소/복원, 최초 이름/소속 snapshot, 50개 목록과 최대2,000건 인쇄가 있다.

API: `/api/sites/:siteId/workers` GET/POST, `workers/:id` PUT; `attendance` GET/POST, `attendance/:id` PUT, `/:id/history` GET, `attendance/print` GET. 파일 `server/attendance.ts`, `attendance-validation.ts`, `attendance-print.ts`; `src/WorkersAttendance.tsx`, `WorkersPanel.tsx`, `AttendancePanel.tsx`.

TBM: `server/tbm.ts`, `tbm-validation.ts`, `tbm-print.ts`; `src/TbmPanel.tsx`, `TbmEditor.tsx`; `tbm_sessions`, `tbm_participants`, `tbm_snapshots`. `/api/sites/:siteId/tbm`와 `/:id/participants`, `/finalize`, `/revise`, `/print`. 제목·날짜·시간·장소·진행자·당일작업·전달사항, 명부 최대200명. pending/present/absent는 **담당자 기록**이다. 확정 후 불변, 정정은 새 초안·참여 pending 초기화. 출역으로 TBM 참석을 자동 확정하지 않는다.

### 남은 구현

**[목표]** 앱 설치 없는 QR 접속, 본인 확인 후 활동별 참여·서명, 명시적 동의 기반 위치 확인. **[미확인]** 본인/대리 기준·동의문·보존기간·거부 대체절차·법적 효력.

**[제안]** 기존 수기 원장과 분리하여 `activity_invitations`(site/activity/documentHash/expiry/revoked), `participation_events`(subject/action/time/documentHash), `consent_records`(purpose/textVersion/grant-or-deny/time), `signature_records`(문서hash·서명자확인수준·서명데이터참조)를 설계한다. 새 `/activity-invitations`와 참여 전용 라우트는 아직 없다. 원토큰은 URL 로그에 보존하지 말고 해시 저장·폐기·만료·재사용 정책을 정의한다. QR만으로 신원이나 참석 완료를 증명하지 않는다.

위치는 버튼/설명/동의 후 요청한다. 거절·권한오류·정확도 부족·시간초과는 별도 상태로 처리하고 자동 동의/백그라운드 연속추적하지 않는다. 좌표·정확도·수집시각과 서버 접수시각을 구분하고 목적에 필요한 최소 범위만 보관한다. 서명은 **정확한 문서 버전/hash**에 결속하며 새 개정본에 재사용하지 않는다. 원장 연결은 사용자 명시 선택/검토를 거치고 활동 간 자동 이수는 만들지 않는다.

검수: 만료/변조/폐기 QR, 다른 현장, 같은 이름, 대리 입력, 중복 제출, 문서 개정 중 서명, 동의 거부, 위치 미지원, 세션/역할 철회, 작은 화면·실기기에서 모두 재현한다.

## 4. SC — 비용·월마감·증빙·재고·보호구

### 화면/입력/처리/출력

**[목표]** 기존 SC UX에 최대한 가깝게 현장 설정→월 선택→예산/전회누계→사용내역→증빙 확인→마감→익월→출력/제출본 비교를 수행한다. 기존 앱 기능 세부는 별도 원앱 목록과 대조한다.

**[코드]** 관리자만 비용/재고 접근. `cost_periods`, `cost_expenses`, `cost_closures`, `cost_events`. 금액은 문자열/BigInt10^6, 수량 소수6자리·단가는 정수 원·행금액 정확 보존. 음수/지수/NaN/자동 반올림 금지. 계획-누계 잔액은 음수도 표시하되 법적 위반으로 단정하지 않는다. 항목1~20, 원장 보존행최대1,000. 후속월이 있는 과거월 재개는 차단한다.

실제 API base는 `/api/sites/:siteId/cost-periods`; `/:id/expenses`, `/:id/close`, `/reopen`, `/carry`, `/closures`, `/closures/:closureId/print`, `/print`. `server/cost-{periods,expenses,money,model,validation,write,print,schema}.ts`; 화면 `src/CostPanel.tsx` 및 Cost 계열 컴포넌트.

| 구현 묶음 | 코드/데이터 | 현재 범위와 주의 |
|---|---|---|
| 일괄입력/검색 | `cost-batch*.ts`, `cost-search*.ts` | 고정5열 TSV100행/100KiB, 검토→원자저장; 전체월 literal 검색. Excel 가져오기 아님 |
| 정확 분할 | `cost-split*.ts`, `CostSplits.tsx` |2~20분할·금액/숫자수량 보존; undo; 재고·증빙 자동 배분 아님 |
| 입력 프리셋 | `cost-preset*.ts` | 설명/수량/단가3필드, 불변 버전, 명시 미저장 적용. 일반 서식빌더 아님 |
| 증빙 | `cost-evidence*.ts`, `CostOutputControl.tsx` | 미검사PNG/JPEG/PDF 원본·같은월 다중행 명시 연결·별도 고정 마감 manifest |
| 제출 기준본 | `cost-baseline*.ts`, `CostBaselines.tsx` | 정확 마감 기반JSON/HTML·수기 제출일 진술·현재비교. 실제 전송/접수 아님 |
| 출력 신선도 | `cost-output.ts` | 현재/마감/기준본 fingerprint 준비·변경시 재준비. 프린터 완료 검출 아님 |
| 수불 | `stock.ts`, `stock-quantity.ts`, `stock-schema.ts` | `stock_items`, `stock_movements`, `stock_events`; exact6·음수거부·역분개 |
| 비용출처 입고 | `cost-stock*.ts` | 비용행출처+사용자 별도 물리수량. 비용수량 자동환산/lot평가 없음 |
| 업체/보호구 | `companies.ts`, `ppe.ts`, `stock-write.ts`, `PpePanel.tsx` | 현재업체UUID·지급/반납snapshot, 제한된부분반납/잔여종결. 본인수령서명 아님 |
| 최소재고 | `stock-minimum*.ts`, `StockMinimumPanel.tsx` | 현재품목 기준·비교/이력; 자동보충/외부알림 없음 |

**[제안] 구현 순서:** (1) 원SC 화면/열/클릭 경로 비교표 작성, (2) 현재웹 부족 UX를 기존 의미 그대로 보완, (3) 미구현 인건비 세분류·Excel장부매핑·증빙묶음·선택출력·업무백업 중 한 가지를 수직 구현, (4) 그 후 선택형 AI·모바일 연결. 3차 잔여 검수·배포와 4차 설계/구현/검증을 별도 대장으로 기록한다.

Excel이 필요하면 원본 파일의 열/시트/단위/수식을 계약화하고 **쓰기 없는 dry-run→오류/중복/금액차이 표→사용자 명시 적용→단일transaction**으로 설계한다. XLSM/VBA/COM 실행 없이 필요한 값만 안전 파싱한다. 실제 원장 ID·기간·전회누계가 불명확하면 가져오기를 중단하고 임의 합치지 않는다. parser 의존성/압축폭탄·수식/외부링크 정책을 먼저 검토한다.

증빙묶음은 선택 기준본과 첨부hash manifest를 고정하고 누락·미검사·변경 상태를 별도 표시하는 작업으로 설계한다. 금융마감과 물리재고·증빙 적격 판정을 자동 동일시하지 않는다. PDF/ZIP 생성은 큐·취소/재시도·정확한 버전 결속이 필요한 별도 구현이다.

AI는 제안 초안·입력보조/차이설명까지만 시작하고 원장 변경·마감·회계판정을 자동 실행하지 않는다. 외부 전송/비용/개인정보 정책 승인 후 provider adapter, 명시 실행, 결과 diff, 사용자 적용, 실패시 원입력 보존을 추가한다. AI off에서 전기능 사용 가능해야 한다.

수용: 원SC 핵심 시나리오 클릭 비교, decimal oracle,1000행/분할/반납 경계, double-click/응답불명, 월마감/이월 경합, 후속월 존재 재개거부, role철회 후 receipt재생403, 과거출력불변, 증빙 누락/변경표시, 실PDF 합계/페이지 검수.

## 5. C — 점검 양식·일정·제출·시정조치

**[코드]** `inspection_templates` 계열, `inspections` 계열, schedules/links/events/snapshots는 각 `inspection-*-schema.ts` 참조. `server/inspection-templates.ts`, `inspections.ts`, `inspection-schedules.ts`, `inspection-links.ts`, `hazards.ts`, `hazard-model.ts`, `hazard-write.ts`. API `/api/sites/:siteId/inspection-templates`, `/inspections`; UI `InspectionsPanel.tsx`, 양식/점검/일정 컴포넌트.

입력: 자체양식 제목·안내·항목, 게시 고정버전, 일정/담당, 점검 답변/부적합·해당없음 사유. 처리: 양식초안→게시→정확버전으로 점검작성→제출→다른 관리자 수락/반려→연결 후속초안. 수락된 부적합항목에서 **명시적** 신고 초안을 생성한다. 신고는 원문→배정→조치보고→독립검토→종결/재개 이력을 갖는다. 자동 안전적합 인증은 아니다.

**[제안]** 양식 관리와 현장 점검 수행을 분리하고 '내 일정/작성중/검토대기'에서 바로 진입. 원앱 양식세트는 사용권·버전·판정 기준을 확보한 후 import preview로 도입한다. 반복일정은 일정 occurrence의 멱등키와 휴일/변경정책부터 정의한다. 사진은 현재 UNSCANNED 다운로드와 안전한 preview를 분리; 검역/디코딩/EXIF 정책 승인 전 `<img>`로 임의 노출하지 않는다.

출력: 고정 제출본+당시양식·검토 이력. 별도 일괄PDF는 아직 없음. 수용: 게시 후 양식변경이 제출본에 소급되지 않음, 본인검토거부, role철회, 부적합→신고 중복방지, 수정후 재제출과 이력/과거PDF 보존, 일정날짜·누락·반려 상태가 명확함.

## 6. D — 일지·순찰·점검참조·월간보고

**[코드]** `server/daily-journals.ts`, `daily-journal-{model,schema,sources,validation,print}.ts`, `daily-inspection-references.ts`, `daily-journal-register.ts`, `daily-monthly-*.ts`; UI `DailyJournalPanel.tsx`, Editor/Sources/Monthly 계열. API `/api/sites/:siteId/daily-journals`. 일지 root는 현장/날짜 유일, 정정은 선형 후속. 현재원자료 취합은 별도 명시행위이고 snapshot과 현재값을 섞지 않는다.

입력: 작업요약/위치, 순찰·지적·개선 메모, 같은현장/날짜 점검 최대10개의 정확 제출원문/hash·당시검토·직접후속 참조. 날짜·현장 변경시 이전 점검 후보/페이지 상태를 초기화한다. 보관/정정, 날짜·상태·내용검색, 월간 최신보관·대기 구분·불변월간기록·현재비교·HTML 출력이 있다.

**[제안]** 일지 화면을 오늘현장 요약→미완료 확인→관찰/조치 입력→참조 확인→보관으로 재설계한다. 기존 점검결과를 단순 복사하지 않고 원문ID/hash·확인시각을 링크한다. 원앱의 사진·서식·순찰 세부필드를 별도 기능표로 대조한다.

오프라인 초안/outbox/사진 대기열/증분동기화/기기철회는 미구현. 도입 시 server version·client operation UUID·deviceID·만료·전송상태를 별도 계약으로 정의하고 온라인 서버권한을 최종 기준으로 한다. 로컬 암호화·공용기기 로그아웃·보존정책 없이 현장자료를 IndexedDB에 저장하지 않는다. 충돌은 둘 중 하나를 조용히 덮어쓰지 않고 diff/재검토로 처리한다.

수용: 날짜변경 후 과거후보 잔류없음, 취합이후 원자료변경 stale표시, 월누락/정정대기와0건 구별, 다른현장참조거부, 과거월간출력불변, 네트워크실패 입력보존. 오프라인은 실제 재접속·권한철회·중복전송까지 검증해야 완료.

## 7. P — 장비·계획·서류·공학 계산

**[코드]** `server/equipment.ts`, `equipment-uses.ts`, `equipment-due.ts`와 schema/model/print; `work-plans.ts`, `work-plan-{validation,model,sources,print,schema}.ts`, review/attachment/document/input/lifting 계열. API `/api/sites/:siteId/work-plans`. `src/WorkPlanEditor.tsx`, 각 WorkPlan*Fields/History/Attachments.

현재 장비UUID·코드·퇴역/재활성·사용이력·검사예정일/보험종료일의 수기 기록을 제공한다. 계획은 제목·날짜·시각·위치·작업설명·비상절차·최대20단계·장비/명부각10개 참조, 명시 취합·제출·다른관리자 수락/보완반려·정정·원본첨부/manifest·고정HTML을 제공한다. 문서수락은 작업허가/공학승인이 아니다.

전용형식 `documentForm.schemaVersion=1`, `kind=general_machine|excavator_lift` 두 개. 공통 지형/지반·지하수·운행경로설명,6가지 위험대책의 미입력/설명/해당없음+사유. 일반 장비총중량 수기값·단위·근거. 굴착기 작업반경/인양높이/매뉴얼정격하중, 화물최대6행 L/H/W/단위중량/기타중량. 값은 소수문자열·단위명시; **합산·환산·하중계수·안전판정 계산 없음**. 선택장비1대 서류참조, 수기지정기록최대10건, 시험보고서최대10건, 달기구6행, 제공 위험대책의 선택참고/출처가 추가되어 있다.

**[목표]** 원앱 17종 문서/계산 범위를 보존하되 자료의 공학적 근거를 검증하고 구현. **[제안]** 원본문서별 입력/단위/상태/필수조건/출력영역/근거/미구현 칸을 만든 뒤 한 문서씩 strict discriminated union으로 확장한다. 기존 저장본에는 새필드 기본값을 주입하지 않고 optional version 계약으로 호환한다. 새문서 종류는 저장후 교체 금지, 종류변경은 새 초안으로 처리한다.

공학계산은 별도 순수함수 모듈과 승인된 검증 fixture로 개발한다. 입력값+단위+출처/제조사판본+적용범위+식버전+반올림정책+결과+검증상태를 보존하고 수기 보고서와 구별한다. 단위가 없는 값을 추정 환산하지 않는다. 현장조건/제조사표/허용하중이 없으면 계산불가를 표시하고0/안전으로 대체하지 않는다.

**[차단 근거]** 크롤러 이중 면적 나눗셈 의심, 고정1.16의 각도/장력·용량 적용 방향, `1.3.5` 문자열,0.85/1.3/0.5/1.5/1.4 계수, 달기구 허용하중과 파단강도 구별, ton/㎡와kN/㎡ 의미가 확정되지 않았다. 저장된 수식이나 cached error를 정답으로 쓰지 않는다. 이 문서는 기술안전 자문이나 계산 승인이 아니다. 전문 검토자가 식·차원·계수·적용범위와 정상/경계/오류 정답을 확정하기 전 안전 판정을 활성화하지 않는다.

수용: 기존두형식 저장/재열기·불완전제출거부·다른manager검토, 정정에서 참조/첨부 재확인,17문서의 누락없는 대조, 단위/분모0/미입력/과도값/변환순서 시험, 독립 oracle 대조, 원자료 계산의 실제값과 출력값 동일성. HTML생성은 통합PDF/16개별PDF/CSV 완성이 아니다.

## 8. EDU — 교육내용·참석·시간·출력

**[코드]** `education_sessions`, `education_participants`, `education_snapshots`, `education_catalog` 계열. `server/education.ts`, `education-record.ts`, `education-validation.ts`, `education-catalog*.ts`, `education-transfer*.ts`, `education-attachment*.ts`; `src/EducationEditor.tsx`, Panel/Participants/Attachments/Catalog 계열. API `/api/sites/:siteId/education`, `/education-catalog`, `/education-content-transfer/{preview,import,candidates,export}`.

입력: 제목·과정표시·강사·목표·본문·현지 같은날 시작/종료·휴게·명부최대200명·개인별수기참석분수. 예정분수=시계차이-휴게, 개인분수는 자동채움하지 않는다. 보관/정정은 snapshot, 정정 참여는pending/0. 작성자 전용수정·manager보관이며 법정 이수/참석증명이 아니다.

내용은 게시판본을 정확 ID/version/hash로 선택하여 일지에 적용한다. 검색/개정/신규사용중지·현재변경경고가 있다. JSON v1은 `format=pedit-own-education-content`, `schemaVersion=1`, `records`의 title/categoryLabel/objectives/contents4필드,1~20행/UTF-8 120KiB. preview는 쓰기없음, 명시행선택·권리진술 후 새 미게시초안 생성, 자동게시/기존덮어쓰기 없음.

**[기록/미확인]** 사용자 원자료50항목의 비공개 변환과 별도 교육91 검토파일 준비가 있다. 교육91은 원자료의 누락 항목을 복원했다는 증거도 법정코드라는 뜻도 아니다. 실제DB import/게시를 하지 않았다. 원자료/본문을 public seed로 복사하지 않는다.

**[제안]** 교육 선택 화면은 과정/적용대상/자료판본/출처/미검토 경고를 보여주고 '전체내용 읽기→명시 적용'을 제공한다. 권리·현행성·적용대상 검수 기록은 현재 v1에 없는 별도 메타데이터 설계가 필요하다. 연구자료 내용의 법률/의학적 최신성은 인수시 공식근거로 다시 확인한다. 적용대상·필수시간을 검증하지 않은 상태에서는 자동 이수판정/수료증을 만들지 않는다.

수용:20행/120KiB/UTF8/BOM/추가필드/긴본문 경계, digest변경 후선택초기화, import원자성·재시도, 게시·사용중지·과거기록불변, 자정넘김/휴게/개인분수, 서명없는기록의명확한표시, A4긴제목/본문/다인참석표 페이지검수.

## 9. 독립 회의록 메뉴

**[코드]** `minutes`, `minutes_records`, `minutes_snapshots`, followups/events. `server/app.ts`, `minutes-{model,records,followups,print,schema}.ts`, attachments 계열; `src/Minutes.tsx`, `MeetingEditor.tsx`, `MinutesFollowupsPanel.tsx`, `MinutesAttachments.tsx`. API `/api/sites/:siteId/minutes` 및 `/:id/finalize`, `/revise`, `/followups`, 별도 `/minutes-followups`.

화면/입력: 안전보건협의체·기타 유형, 제목/일시/장소/작성자, 참석자문자열, 안건/논의/결정, 후속 task/owner/due/status. 처리: 초안→manager기록확정→원문고정→사유있는정정. 후속조치는 고정본문+actionIndex를 출처로 실제 계정 배정→보고→다른manager확인→재개방. 원회의 인쇄는 현재후속상태로 변경하지 않는다. PNG/JPEG/PDF라벨 원본은 미검사 download-only.

**[제안]** 회의작성과 후속조치 보드를 나눠 오늘기한/담당별 탐색을 제공하되 회의록 메뉴는 교육/TBM 내부에 숨기지 않는다. 참석자 본인확인/서명, 법적 위원자격·필수값·범용결재는 별도 정책 확정 후 구현한다. 실제 문자열 '완료'를 verified상태와 합치지 않는다.

수용:20k안건/50항목 등 긴내용, 독립후속검토, 정정초안 상태초기화/첨부미상속, 동일버전경합, 원회의hash·인쇄불변, 한글다중페이지·서명영역·표 잘림.

## 10. N — 사진대지 / WEB·배포·모바일 기반

### 사진대지

**[코드]** 현재 통합웹에 사진편집·대지모듈은 미구현이다. 신고첨부 저장은 대체 기능이 아니다. **[목표]** 파일/폴더입력·EXIF방향/촬영일·포함/제외/순서/90도회전·확대/원형강조·제목/현장/작업내용/하단정보·PNG/PDF·undo/redo·접근성·프로젝트저장복원·caption/TSV 기능을 대조한다.

**[제안]** 원본과 편집scene(사진ID·변환·정규화좌표·caption·순서·포함여부·layoutVersion)를 분리한다. 회전/크롭 후 강조좌표 의미와 undo명령을 고정하고 안전 decode·픽셀수/파일수/메모리상한부터 정의한다. 프로젝트 저장은 schemaVersion+원본hash+scene manifest, 누락파일은 복구필요로 표시한다. 서버 preview/PNG/PDF가 필요하면 격리된 처리와 한도·취소·재시도 계약을 먼저 도입한다. 새의존성/저작권/개인정보 EXIF제거 정책은 검토 후 선택한다.

수용:동일scene 재열기동일출력,8방향EXIF,회전과강조좌표,한글폰트/가로세로사진/대용량/손상파일,undo/redo·키보드,PNG화질과PDF페이지/내용,TSV탭/줄바꿈 처리. 원본사진 삭제/손실 없이 작업해야 한다.

### 기존 WEB·배포·모바일

**[코드]** 현재 홈의 광고자리 기본OFF 외 실제 커뮤니티/자료실/뉴스/날씨/배포목록은 미구현. 반응형웹은 네이티브Android 완성이 아니다. 기존 런처 설치·업데이트·롤백을 이 통합웹에서 재구현한 상태도 아니다.

**[제안]** 커뮤니티는 게시/검수/공개범위/신고·반응·북마크를 내부현장 문서와 별도 접근모델로 설계한다. 자료실은 파일권리/버전/검역/다운로드권한, 릴리스목록은 버전·해시·서명검증·지원환경을 명시한다. 뉴스/날씨는 공급원·확인시각·실패/캐시를 표시하고 안전의사결정의 유일한 근거로 삼지 않는다. 외부광고/SDK/분석/AI는 명시승인·동의 전 켜지 않는다. 문서/입력/서명/인쇄에는 광고를 넣지 않는다.

네이티브앱이 필요한지는 모바일웹의 실제사용성·권한·카메라/파일선택·QR흐름을 먼저 검증한 후 결정한다. 기존 앱 재작성보다 app-free 웹 목표와 중복되지 않는 역할을 정의한다.
