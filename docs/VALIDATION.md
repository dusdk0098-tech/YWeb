# 공개용 검증 요약

2026-10-30, 앱0.79.0/DB56·backup56. 아래는 최초 공개 staging 당시 결과입니다. 이후 로컬 수정본의 Windows 검사 결과와 남은 실패는 [PC 검증 기록](PC_VALIDATION.md)을 보세요. 개인정보/내부경로를 제외한 요약이며 비공개 원로그/대화/검토이력을 포함하지 않습니다.

원 개발본 최종 npm run check: lint/typecheck/366tests PASS,0FAIL/build PASS. 관련 migration/backup12PASS, CLI schema56. 제한된 독립8 probes/4 renderer 확인은 전체 독립보안 인증이 아닙니다. SEC-LOCAL-01 P2 미해결.

## 공개 staging 재현 결과
- 독립된 새 설치에서 `npm ci --no-audit --no-fund` 성공(240 packages). 먼저 시도한 offline 설치는 캐시 누락으로 실패했으며 정상 온라인 설치로 확인했습니다. 의존성/lock 변경은 없습니다.
- `npm run check` exit0: lint/typecheck/**366tests PASS,0FAIL**/build PASS.
- 실제 실행 명령 smoke: stdin 합성계정발급→loopback 서버시작→session/CSRF 로그인→빌드된 index HTTP200, backup help schema56 확인. 임시 합성DB는 종료 후 삭제했습니다. 브라우저 실사용 검사는 아닙니다.
- 실행source/public·합성시험565파일이 원 개발본과 byte동일. 상대import/문서링크 누락 없음.
- 알려진 private본문233개 전체문자열 대조 노출0. 주요 토큰/개인키·내부대화·사용자별절대경로 패턴과 금지산출물 검사에서 발견0. 패턴/전체문자열 검사는 완전한 개인정보·권리 검증이 아닙니다.
- 별도 read-only 공개tree 검토도 실행source일치·상대import·문서링크·비밀패턴을 확인했습니다. 전체 보안 인증으로 해석하지 않습니다.
- GitHub CI는 contents:read, 인증정보 checkout 저장없음, Node24 `npm ci`→`npm run check`만 준비했습니다. 배포 없음. 공개 전 원격 CI는 미실행입니다. 사용한 공식 [checkout](https://github.com/actions/checkout)·[setup-node](https://github.com/actions/setup-node)의 v7 태그를 확인해 commit SHA로 고정했습니다.

실제 PC·브라우저/PDF페이지·모바일/접근성·운영복구·실사용수용, 최신 advisory 조회, 법정/의학/공학 적합성은 검증하지 않았습니다. SSR·API 성공은 현장안전/실제인쇄 인증이 아닙니다.
