# 명시적 로컬 백업

npm run backup:local -- --help로 지원 schema16~56과 사용법을 확인하세요. 환경변수/.env를 자동 로드하거나 writer를 종료하지 않습니다. 앱·계정발급 등 모든 writer 종료를 직접 확인하고 정확한 DB 절대경로·신뢰하는 운영자 폴더권한·여유공간을 확인하세요. 아직 존재하지 않는 목적폴더가 필요합니다. 아래는 교체용 예시 경로입니다.

```sh
npm run backup:local -- export --source /absolute/path/pedit.sqlite --destination /absolute/path/new-bundle --writers-stopped
npm run backup:local -- verify --bundle /absolute/path/new-bundle
npm run backup:local -- list --bundle /absolute/path/new-bundle
```

--writers-stopped는 사용자 진술이며 프로세스 검사 결과가 아닙니다. schema/hash/integrity/FK를 검사하지만 자동 schema업그레이드가 아닙니다. 이전 schema 백업도 복원되며, 복원한 DB는 앱 시작 시 기존 마이그레이션으로 올라갑니다. 종료0=성공,2=형식오류,1=실패입니다.

백업에는 비밀번호hash·세션·개인정보·미검사 원본이 포함될 수 있습니다. 암호화·전송·자동보존·운영복구를 제공하지 않으며 같은 디스크 사본은 디스크고장을 막지 못합니다. 복원 CLI는 없습니다. 합성 리허설helper를 운영 계정회복 승인 없이 사용하지 마세요.
