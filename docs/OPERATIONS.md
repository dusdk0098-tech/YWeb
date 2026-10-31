# 로컬 개발 운영

Node24.x/앱0.79.0/DB56·backup56. README 설치·계정발급·build/start 절차를 사용하세요. 실데이터/원격배포 절차가 아닙니다.

전용계정·private 데이터폴더와 상위경로·DB/WAL/SHM·백업 mode/ACL을 확인하세요. 기존0755폴더+umask022→0644 파일 SEC-LOCAL-01 P2가 열려 있습니다. 정리: 서버를 끄고 백업을 확인한 뒤 `npm run secure-data`(미리보기) → `npm run secure-data -- --apply [--backup <백업폴더>]`. `.env`·DB·첨부·백업은 공유/commit하지 마세요. APP_ORIGIN/포트 일치 및127.0.0.1 바인딩을 유지하세요. 백업은 명시적 export/verify/list이며 암호화·자동보존·실제운영복구가 아닙니다. recovery marker를 지워 옛 계정상태로 재개하지 마세요. 실제 PC·모바일/PDF·사용자수용과 운영 security gate는 미완료입니다.
