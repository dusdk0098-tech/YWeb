# 보안 상태와 책임 있는 신고

**로컬 합성 개발용입니다. 인터넷/LAN 서비스나 실데이터 운영에 사용하지 마세요.** loopback만 바인딩하고 production 시작을 거부합니다. HTTP/Secure=false 쿠키는 이 개발 제한에서만 사용합니다.

서버 현장권한·CSRF/Origin·세션회전/폐기·idempotency/버전충돌·prepared SQL·escaping을 구현했습니다. 제한된 독립 합성8 probes/4 renderer 확인은 전체앱 보안 인증이 아닙니다. 단일 비용 생성경합 차단을 모든 mutation의 경쟁 검증으로 확대하지 않습니다.

## SEC-LOCAL-01 — P2, 미해결
기존0755 데이터 폴더+umask022에서 DB/WAL/SHM0644가 재현됐습니다. 다른 OS사용자가 상위경로를 탐색할 수 있고 ACL 차단이 없으면 원문·세션·비밀번호 hash가 읽힐 수 있습니다. 새0700 전용폴더와 구분하세요. 전용 계정·폴더/파일 소유권·mode/ACL·백업 접근권한 확인이 필요합니다. 코드가 기존권한을 자동 변경하지 않습니다. 대책 A안(승인): 서버 시작 시 DB 폴더·DB/WAL/SHM·`.env` 권한을 읽기만 하고(POSIX mode, Windows `icacls`), 본인·SYSTEM·Administrators 외 읽기 권한이 있으면 서버 로그와 관리 현장 현황 화면에 경고합니다(`server/local-permissions.ts`). 경고는 해소가 아니며 P2는 열린 상태입니다.

DB/백업 암호화·OS/디스크 보호·보존삭제·운영복구 수용은 미완료입니다. 복원 시 옛 비밀번호 hash가 돌아올 수 있으므로 recovery marker·계정/비밀 회전 승인 없이 서비스를 재개하지 마세요. 첨부는 UNSCANNED download-only이며 헤더/해시는 AV·진위 인증이 아닙니다. 실제 PC·브라우저CSP·PDF·모바일·접근성 수용 및 최신 의존성 advisory 원격조회·전체 침투시험은 미완료입니다. 테스트 비밀번호/email/UUID는 합성 fixture이므로 실제 계정에 재사용하지 마세요.

## 신고
공개 이슈에 exploit 상세·토큰·비밀번호·DB·개인정보를 올리지 마세요. 저장소 비공개 취약점 신고가 활성화되어 있으면 그 경로를 사용하고, 아니라면 유지관리자와 비공개 경로를 먼저 합의하세요. 이 문서는 해당 GitHub 설정의 활성화를 보증하지 않습니다.
