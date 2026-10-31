# SEC-LOCAL-01 대책안 (A·B안 승인)

**상태: A안 승인·구현(읽기 전용 점검·경고, `server/local-permissions.ts`). B안 승인·구현(`scripts/secure-data.ts`, `npm run secure-data`, 미리보기 기본·`--apply` 때만 변경, POSIX umask 077). 실제 데이터에는 운영자가 직접 실행한다.** 인계문서(00_START_HERE)와 `SECURITY.md`는 SEC-LOCAL-01(P2)을 임의로 해소하지 말라고 정했다.

## 문제(현재 기록 그대로)

- 이미 있던 0755 데이터 폴더와 umask 022에서는 DB/WAL/SHM 파일이 0644로 만들어진다. 다른 OS 사용자가 상위 경로를 지나갈 수 있으면 원문·세션·비밀번호 hash를 읽을 수 있다.
- 앱이 새로 만드는 폴더는 이미 0700이다(`server/db.ts` `mkdirSync(..., { mode: 0o700 })`). 백업 CLI는 0700 폴더와 0600 파일을 만든다(`scripts/local-backup.ts`). 문제는 **이미 있던 느슨한 폴더**이다.
- Windows에서는 mode가 아니라 ACL이 기준이다. 상속된 `Users`/`Authenticated Users` 읽기 권한이 같은 문제를 만든다.

## 선택지

### A안 (권장 1단계): 읽기 전용 점검과 경고만

- 서버 시작 시 DB 폴더와 DB/WAL/SHM, `.env`, 백업 폴더의 권한을 **읽기만** 한다.
  - POSIX: `stat`으로 group/other 읽기·실행 비트와 상위 경로 탐색 가능 여부를 확인한다.
  - Windows: `icacls <경로>`를 읽기 전용으로 실행해 본인·SYSTEM·Administrators 외의 읽기 권한(예: `Users`, `Authenticated Users`, `Everyone`)을 찾는다.
- 위험하면 서버 로그와 관리자 화면에 경고와 OS별 수동 조치 방법을 보여 준다. 시작은 막지 않는다.
- 권한은 바꾸지 않으며, 새 의존성도 없다.

### B안 (2단계, 별도 승인): 운영자가 직접 실행하는 정리 명령

- `npm run secure-data -- --dry-run`으로 바꿀 내용을 먼저 보여 주고, `--apply`일 때만 바꾼다.
  - POSIX: 폴더 0700, 파일 0600.
  - Windows: `icacls /inheritance:r`로 상속을 끊고, 현재 사용자·SYSTEM·Administrators에게만 권한을 준다.
- 서버 시작 시 `process.umask(0o077)`을 적용해, 앞으로 만들어질 WAL/SHM 같은 파일도 본인 전용으로 만든다(기존 파일은 바꾸지 않음).
- 실행 전 백업을 확인하고, 실행 결과를 기록한다.

### C안: 문서 점검표만 유지

지금처럼 `docs/OPERATIONS.md`의 수동 점검에 맡긴다.

## 결정이 필요한 것

1. A안을 먼저 넣을지(권장), C안으로 둘지.
2. B안(권한 변경 명령, umask 077)을 승인할지. 승인해도 실행은 운영자가 명시적으로 한다.
3. Windows 경고 기준: 본인·SYSTEM·Administrators 외 읽기 권한을 모두 경고로 볼지.

## 승인 후에도 PASS로 표시하지 않을 것

실제 운영 PC의 다른 계정으로 읽기 시도 재현, 도메인/공유 PC ACL, 디스크 암호화, 독립 보안검토.
