# LNReader 설치 및 북토끼 연동 가이드

이 문서는 LNReader 앱을 설치하고 북토끼 소설을 읽을 수 있도록 설정하는 전체 과정을 설명합니다.

---

## 준비물

- 안드로이드 스마트폰
- Linux PC (FlareSolverr 실행용)
- GitHub 계정
- Docker 설치된 PC

---

## 1단계: LNReader 앱 설치

1. 안드로이드 폰에서 아래 링크 접속:
   ```
   https://github.com/LNReader/lnreader/releases/latest
   ```
2. 최신 `.apk` 파일 다운로드
3. 설치 (설치 전 **알 수 없는 출처 허용** 필요)

---

## 2단계: 플러그인 저장소 등록

1. 앱 실행 → **Settings** → **Browse** → **Repositories**
2. **+** 버튼 누르고 아래 URL 입력:
   ```
   https://raw.githubusercontent.com/LNReader/lnreader-plugins/plugins/v3.0.0/.dist/plugins.min.json
   ```
3. 확인

> 이 URL은 플러그인 목록을 제공하는 저장소 주소입니다. 이 저장소가 사라질 경우를 대비해 본인 GitHub에 백업하는 것을 권장합니다. (7단계 참고)

---

## 3단계: 북토끼 플러그인 설치

1. **Browse** 탭 → 플러그인 목록에서 **booktoki** 검색
2. 다운로드(↓) 버튼 눌러 설치

---

## 4단계: FlareSolverr 설치 (북토끼 캡차 우회)

북토끼는 Cloudflare 캡차를 사용해서 FlareSolverr가 필요합니다.
FlareSolverr는 **가정용 인터넷(집 PC)** 에서 실행해야 합니다.
(서버/VPS IP는 북토끼에서 차단됩니다.)

### Docker로 실행

기존 서버에 다른 서비스가 있다면 `docker-compose.yml`에 추가하는 방식을 권장합니다:

```yaml
services:
  flaresolverr:
    image: ghcr.io/flaresolverr/flaresolverr:latest
    restart: unless-stopped
    expose:
      - "8191"
    environment:
      - LOG_LEVEL=info
    networks:
      - npm_default

networks:
  npm_default:
    external: true
```

```bash
docker compose up -d flaresolverr
```

### 정상 동작 확인

브라우저에서 아래 주소 접속 시 JSON 응답이 오면 성공:
```
http://localhost:8191
```
```json
{"msg": "FlareSolverr is ready!", "version": "3.x.x", ...}
```

---

## 5단계: Nginx Proxy Manager로 도메인 연결 (선택)

FlareSolverr를 외부에서 접근 가능하도록 도메인을 연결합니다.

1. NPM 관리 화면 접속 (`http://<PC IP>:81`)
2. **Proxy Hosts** → **Add Proxy Host**
3. 아래처럼 입력:

   | 항목 | 값 |
   |------|-----|
   | Domain Names | `flaresolver.yourdomain.com` |
   | Scheme | `http` |
   | Forward Hostname | FlareSolverr 컨테이너 IP 또는 이름 |
   | Forward Port | `8191` |

4. **SSL 탭** → Let's Encrypt 발급 → Force SSL 체크 → Save

> **주의**: 앱에서 HTTP URL은 차단될 수 있으므로 HTTPS로 설정하는 것을 권장합니다.

---

## 6단계: 앱에서 FlareSolverr 연결

1. Browse 탭 → 북토끼 플러그인 → **필터(깔때기) 아이콘**
2. **FlareSolverr URL** 항목에 입력:
   ```
   https://flaresolver.yourdomain.com/v1
   ```
3. **Filter** 버튼 눌러 저장
4. 소설 목록 및 챕터 확인

---

## 7단계: 본인 GitHub에 플러그인 저장소 백업 (권장)

원본 저장소가 사라져도 계속 사용할 수 있도록 본인 GitHub에 올려둡니다.

### 저장소 생성

1. GitHub에서 새 저장소 생성 (예: `lnreader_plugins`)
2. **Public**, README 없이 생성

### GitHub Actions 설정

```
https://github.com/<계정>/lnreader_plugins/settings/actions
```
- **Allow all actions and reusable workflows** 선택
- **Require actions to be pinned to a full-length commit SHA** 체크 **해제**
- Save

### push

```bash
git remote add myfork https://github.com/<계정>/lnreader_plugins.git

# plugins/ 폴더 변경이 있어야 워크플로우가 실행됨
touch plugins/.trigger
git add plugins/.trigger
git commit -m "trigger publish workflow"
git push myfork master
```

### 워크플로우 확인

```
https://github.com/<계정>/lnreader_plugins/actions
```

**Publish Plugins** 워크플로우가 성공(초록색)하면 아래 URL 사용 가능:

```
https://raw.githubusercontent.com/<계정>/lnreader_plugins/plugins/v3.0.0/.dist/plugins.min.json
```

### 앱에서 URL 교체

Settings → Browse → Repositories에서 기존 URL 대신 위 URL로 교체합니다.

---

## 문제 해결

### 소설 목록이 로딩되지 않음 (스피너만 돌아감)
- FlareSolverr가 **가정용 인터넷**에서 실행되고 있는지 확인
- 서버/VPS에서 실행하면 북토끼에서 IP 차단됨

### FlareSolverr 502 Bad Gateway
- NPM의 Forward Hostname을 컨테이너 이름 대신 **IP 주소**로 변경

### 챕차가 계속 뜨는 경우 (PHPSESSID 방법)
FlareSolverr 없이도 해결 가능합니다:
1. 휴대폰 브라우저에서 북토끼 접속 → 캡차 통과
2. 필터 화면의 **북마크 코드** 전체 복사
3. 브라우저 주소창에 붙여넣기 → PHPSESSID 값 복사
4. 필터의 **Session Cookie (PHPSESSID)** 항목에 입력
