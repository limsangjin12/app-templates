---
name: new-app
description: 이 앱 monorepo에 새 앱을 부트스트랩한다. Flutter, iOS, macOS 앱 디렉터리 생성, README/AGENTS/CLAUDE/ROADMAP 작성, docs 정적 페이지, deploy.config.sh, Netlify/Vercel/AWS 호스팅 선택 계획까지 잡는다.
---

# /new-app

새 앱을 만들 때 사용한다. 목표는 앱 코드를 만들기 전에 `ROADMAP.md`로 제품 범위와 출시 기준을 먼저 고정하는 것이다.
가능하면 `node scripts/new-app.mjs`를 사용해 문서와 정적 페이지 템플릿을 먼저 생성한다.

## 입력

필요한 값이 인자로 없으면 사용자에게 묻는다.

| 필드 | 예시 | 비고 |
|---|---|---|
| `app_name` | `card-counter` | kebab-case 디렉터리 이름 |
| `platform` | `flutter` / `ios` / `macos` | 지원 플랫폼 |
| `category` | `games` / `utilities` | 없으면 새 카테고리 생성 |
| `bundle_id` | `com.example.cardcounter` | 기본값은 사용자의 org prefix를 확인 후 결정 |
| `display_name` | `Card Counter` | README, docs, store metadata에 사용 |
| `description` | `카드 게임 점수 계산기` | 1-3문장 |
| `constraints` | `iOS 17+, iPhone only` | OS, 기기, 네트워크, 계정, 유료화 등 |
| `hosting` | `netlify` / `vercel` / `aws` | 홈페이지/개인정보처리방침 공개 방식. 모르면 나중에 선택 |

## 생성할 파일

```
<category>/<app_name>/
├── README.md
├── AGENTS.md
├── CLAUDE.md
├── ROADMAP.md
├── deploy.config.sh
└── docs/
    ├── index.html
    └── privacy.html
```

`ROADMAP.md`는 `templates/app/ROADMAP.md`를 기반으로 작성하고 다음 항목을 반드시 채운다.

- 앱의 목적
- 핵심 기능
- 디자인 원칙
- 개발 순서와 우선순위
- 출시 전 체크리스트

## 생성 명령

```sh
node scripts/new-app.mjs \
  --name=<app_name> \
  --platform=<platform> \
  --category=<category> \
  --bundle-id=<bundle_id> \
  --display-name="<display_name>" \
  --description="<description>" \
  --constraints="<constraints>" \
  --hosting=<hosting>
```

이미 파일이 있는 앱에 템플릿을 다시 적용해야 할 때만 `--force`를 사용한다.

## 스캐폴드

### Flutter

```sh
flutter create \
  --org <bundle id prefix> \
  --project-name <app_name with underscores> \
  --platforms=<ios,android,macos,web 중 선택> \
  <category>/<app_name>
```

생성 후 `pubspec.yaml`, Android `applicationId`, iOS bundle id를 확인한다.

### iOS

XcodeGen을 선호한다. 최소 `project.yml`, `Sources/<App>App.swift`, `Sources/ContentView.swift`,
`Resources/PrivacyInfo.xcprivacy`를 만든다. `CLAUDE.md`는 항상 `AGENTS.md` 참조 문구만 둔다.

### macOS

XcodeGen 또는 SwiftPM 중 repo 표준을 따른다. App Store 배포 목표라면 App Sandbox를 기본으로 켠다.

## 문서

`templates/docs/index.html`과 `templates/docs/privacy.html`의 placeholder를 채워 `<app>/docs/`에 복사한다.

개인정보처리방침은 실제 동작과 맞아야 한다. 광고, 추적, 계정, 결제, 클라우드, analytics, crash reporting,
AI API 사용 여부를 명확히 적는다.

## 배포 설정

앱별 `deploy.config.sh`는 아래 패턴으로 만든다.

```sh
APPS_DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../apps-deployment" && pwd)"
export APPS_DEPLOY_DIR
source "$APPS_DEPLOY_DIR/shared.config.sh"

export ASC_BUNDLE_ID="<bundle_id>"
export ASC_APP_NAME="<display_name>"
export PLAY_PACKAGE_NAME="<bundle_id>"
```

비밀 값은 이 파일에 넣지 않는다. 필요한 경우 환경변수나 로컬 secret path만 참조한다.
생성 후에는 다음 명령으로 누락된 환경변수를 확인한다.

```sh
node scripts/check-env.mjs --app=<category>/<app_name> --platform=<platform>
```

## Infra

정적 페이지를 공개해야 하면 Netlify, Vercel, AWS 중 하나를 선택한다.

- Netlify: `infra/netlify/README.md`를 따르고 공개 URL을 `infra/scripts/apps-config.mjs`에 반영한다.
- Vercel: `infra/vercel/README.md`를 따르고 공개 URL을 `infra/scripts/apps-config.mjs`에 반영한다.
- AWS: `infra/aws/main.tf`의 `local.pages`와 `infra/scripts/apps-config.mjs`에 앱을 등록한다. Terraform은 AWS 선택 시에만 `cd infra/aws && terraform apply`로 실행한다.

선택이 아직 안 됐으면 `ROADMAP.md` 출시 전 체크리스트에 호스팅 결정 항목을 남긴다.
Netlify/Vercel 공유 site를 쓰면 `node infra/scripts/build-static-site.mjs --out=public-site`로 앱별 docs를 모은다.

## 마무리

새 앱 생성 후 사용자에게 다음을 요약한다.

- 생성된 앱 경로
- 작성된 `ROADMAP.md`의 MVP 범위
- 다음에 실행할 빌드 명령
- 필요한 수동 계정/스토어 준비 작업
