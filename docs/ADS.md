# 광고 (개발자 광고 피드)

Y웹은 오픈소스이며 개발자가 광고 수익으로 유지합니다. 광고는 **외부 광고망이 아니라 개발자가 직접 운영하는 피드**에서 옵니다 (`docs/UI_REDESIGN_PLAN.md` 결정 6).

## 어떻게 동작하나

- 광고 목록(`ads.json`)과 이미지는 별도 공개 저장소(GitHub Pages)에 있습니다. 기본 주소: `https://dusdk0098-tech.github.io/yweb-ads/ads.json` (`.env`의 `ADS_FEED_URL`로 바꿀 수 있음).
- **설치된 앱의 서버**가 하루 한 번 받아 형식·크기를 검사하고 `data/ads/`에 저장합니다. 화면은 자기 서버의 `/api/ads`에서만 받습니다. 브라우저는 외부 주소에 접속하지 않으며, CSP는 그대로입니다.
- 받는 것은 글(제목 60자, 문구 140자)·링크(https)·이미지(PNG/JPEG, 300KB 이하)뿐입니다. HTML·스크립트는 받지 않습니다.
- 피드 요청에는 현장·계정·사용 정보가 실리지 않습니다(`User-Agent: YWeb-ads/1`만). 노출·클릭은 앱이 세지 않습니다. 클릭은 새 탭으로 링크를 열 뿐이며, 집계가 필요하면 링크에 UTM을 붙여 광고주 쪽에서 하세요.
- 인터넷이 끊기면 마지막으로 받은 광고가 그대로 보입니다. 피드가 잘못되면 이전 복사본을 유지합니다.
- 운영자는 설치 PC에서 설정 → 계정 발급 화면의 **광고 표시**를 끌 수 있습니다(기본 켬). 끄실 때는 개발자 후원을 부탁드립니다.

## 피드 형식 (`ads.json`)

```json
{
  "version": 1,
  "ads": [
    { "id": "safety-shop", "title": "안전용품 할인", "text": "현장 보호구 10% 할인 (예시)", "url": "https://example.com/shop", "image": "shop.png", "from": "2026-11-01", "to": "2026-12-31" }
  ]
}
```

| 필드 | 규칙 |
|---|---|
| `id` | 소문자·숫자·하이픈, 40자 이하, 고유 |
| `title` | 60자 이하 |
| `text` | 140자 이하, 비워도 됨 |
| `url` | `https://`로 시작, 300자 이하 |
| `image` | `ads.json` 옆 파일 이름(`이름.png/.jpg`), 300KB 이하. 없어도 됨 |
| `from` / `to` | `YYYY-MM-DD`, 그 기간에만 표시. 없으면 항상 |

광고는 20개까지, 파일은 64KB 이하.

## 저장소 만들기 (한 번)

1. GitHub에 공개 저장소 `yweb-ads`를 만듭니다.
2. `docs/ads-feed-template/`의 `ads.json`과 이미지를 저장소 루트에 넣고 커밋합니다.
3. 저장소 Settings → Pages → Source를 `main` 브랜치 루트로 설정합니다. 몇 분 뒤 `https://<계정>.github.io/yweb-ads/ads.json`이 열립니다.
4. 주소가 기본값과 다르면 설치본 `.env`에 `ADS_FEED_URL=`로 적습니다.

형식 검사는 저장소에 GitHub Actions로 `node -e` 한 줄을 두어 `ads.json`이 JSON인지 확인하는 정도로 충분합니다. 앱 쪽 검사(`server/ads.ts`)가 최종 관문입니다.
