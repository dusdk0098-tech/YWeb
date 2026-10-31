# 이 PC를 서버로 쓰기 (외부 접속)

Y웹을 설치한 PC가 그대로 서버가 되어, 휴대폰·다른 PC에서 구매한 도메인(예: `https://safety.example.com`)으로 접속하게 하는 방법이다. 설정은 앱의 **외부 접속 설정** 메뉴에서 하며, **이 PC에서 직접 접속했을 때만** 바꿀 수 있다. 저장 후 앱을 다시 시작하면 적용된다.

- 이 PC가 켜져 있고 앱이 실행 중일 때만 밖에서 접속된다.
- 꺼 둔 상태(기본)에서는 지금처럼 이 PC(`http://127.0.0.1:3000`)에서만 열린다.
- 밖에 열면 누구나 로그인 화면에 닿는다. 모든 계정에 12자 이상의 강한 비밀번호를 쓰고, 쓰지 않는 계정은 지운다. 로그인은 계정별·접속 주소별로 15분에 실패 10회·30회에서 막힌다.
- AI 공용 키와 외부 접속 설정 같은 PC 공용 설정은 밖에서 접속하면 보이지도, 바뀌지도 않는다.

두 가지 방식 중 하나를 고른다.

| | 직접 연결 + 자동 HTTPS | Cloudflare Tunnel |
|---|---|---|
| 필요한 것 | 도메인, 공인 IP, 공유기 포트포워딩(80·443) | 도메인, Cloudflare 무료 계정, cloudflared 설치 |
| DNS | 직접 A 레코드 등록 | Cloudflare가 자동 등록 |
| 인증서 | 앱이 Let's Encrypt에서 자동 발급·갱신(만료 30일 전) | Cloudflare가 처리 |
| 맞는 경우 | 공유기 설정을 바꿀 수 있는 사무실·집 | 포트를 열 수 없거나 공인 IP가 자주 바뀌는 곳 |

## A. 직접 연결 + 자동 HTTPS

1. **도메인 DNS**: 도메인을 산 회사의 DNS 관리에서 A 레코드(예: `safety` → 이 사무실의 공인 IP)를 만든다. 공인 IP는 공유기 관리 화면에서 확인한다. 공인 IP가 바뀌는 회선이면 공유기의 DDNS 기능이나 B 방식을 쓴다.
2. **공유기 포트포워딩**: 외부 TCP 80, 443을 이 PC의 내부 IP 80, 443으로 보낸다. 80은 인증서 발급 확인과 https 이동에만 쓴다.
3. **Windows 방화벽**: 앱이 OS 보안 설정을 대신 바꾸지 않는다. 관리자 PowerShell에서 직접 실행한다.
   ```powershell
   New-NetFirewallRule -DisplayName "Y웹 HTTP/HTTPS" -Direction Inbound -Protocol TCP -LocalPort 80,443 -Action Allow
   ```
4. **앱 설정**: 외부 접속 설정 → 방식 "직접 연결 + 자동 HTTPS", 도메인, 인증서 알림 이메일 입력, Let's Encrypt 이용약관 동의 → 저장. 화면의 "DNS 조회 결과"에 공인 IP가 보이면 DNS가 준비된 것이다.
5. **앱 다시 시작**: 시작하면서 인증서를 받는다(수십 초). 상태가 "실행 중"이 되면 휴대폰에서 `https://도메인`으로 접속해 확인한다. 실패하면 이유가 설정 화면과 콘솔 창에 나온다(대부분 DNS 전파 전이거나 80 포트가 막힌 경우).

인증서와 계정 키는 `data/tls/`에 저장된다(`TLS_DIR`로 변경 가능). 공유기가 외부 80/443을 다른 내부 포트로 보내야 하면 `.env`에 `PUBLIC_HTTP_PORT`, `PUBLIC_HTTPS_PORT`를 지정한다.

## B. Cloudflare Tunnel

1. Cloudflare 무료 계정을 만들고 도메인을 추가한다. 도메인 회사에서 네임서버를 Cloudflare가 알려 준 값으로 바꾼다.
2. Cloudflare 대시보드 → Zero Trust → Networks → Tunnels → 터널 만들기(Cloudflared). 설치 안내 화면의 명령에 들어 있는 토큰(`eyJ…`)을 복사한다.
3. 터널의 Public Hostname: 하위 도메인/도메인을 정하고, Service는 `HTTP` / `127.0.0.1:3000`. DNS 레코드는 Cloudflare가 자동으로 만든다.
4. 이 PC에 cloudflared 설치(관리자 권한 필요할 수 있음):
   ```powershell
   winget install --id Cloudflare.cloudflared
   ```
   다른 위치에 설치했다면 `.env`에 `CLOUDFLARED_PATH`를 지정한다.
5. 앱 설정: 외부 접속 설정 → 방식 "Cloudflare Tunnel", 도메인, 터널 토큰 → 저장 → 앱 다시 시작. 앱이 cloudflared를 직접 실행하고 끊기면 다시 연결한다. 토큰은 암호화해 저장하고, 실행할 때 환경 변수로만 넘긴다.

## 알아 둘 점

- 저장된 터널 토큰·AI 키는 `.env`의 `SESSION_SECRET`으로 암호화된다. `SESSION_SECRET`을 바꾸면 다시 입력해야 한다.
- TBM 참여 QR은 외부 접속이 켜져 있으면 공개 도메인 주소로 만들어진다. 꺼져 있으면 이 PC에서만 열리는 주소이며 화면에 그렇게 표시된다.
- 이 PC가 서버이므로 정전·재부팅·절전 때는 접속이 끊긴다. 백업(`npm run backup:local`)과 데이터 폴더 권한 정리(`npm run secure-data -- --apply`)를 먼저 해 둔다.
- 실제 도메인으로 인증서 발급·터널 연결을 해 본 기록은 아직 없다(개발 중 시험은 가짜 인증기관·가짜 cloudflared와 높은 포트의 자체 서명 인증서로 했다).
