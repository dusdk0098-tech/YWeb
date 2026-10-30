# 공개 개발본 작업 지침

README.md, HANDOFF.md, SECURITY.md, docs/VALIDATION.md를 먼저 읽으세요. 합성 데이터만 사용하며 실제 DB/개인문서/비밀을 추가하지 마세요. 서버 인가·CSRF·세션·idempotency·버전충돌·불변snapshot·escaping을 유지하세요. 변경 후 npm run check와 관련 migration/backup 회귀를 실행하세요. 브라우저/PDF/모바일 미실행을 PASS로 표기하지 마세요. 공학계수/안전·법적판정/실제참석을 추정하지 마세요. 운영배포·라이선스 부여·실제자료 이관은 별도 승인 사항이며 소스 공개는 해당 승인이 아닙니다.
