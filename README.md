# 앱 템플릿

여러 앱을 한 repository에서 개발하기 위한 monorepo 템플릿입니다.

이 repo는 앱 소스와 민감정보를 포함하지 않습니다. 대신 새 앱을 빠르게 시작하는 데 필요한
문서 템플릿, 공통 배포 스크립트, App Store Connect / Google Play 자동화 helper,
정적 페이지 호스팅 가이드, Claude Code / Codex skill 문서를 제공합니다.

## 빠른 시작

GitHub의 **Use this template** 버튼으로 새 repository를 만들거나 clone 후 사용합니다.

```sh
git clone git@github.com:<your-org>/app-templates.git my-apps
cd my-apps

npm run new-app -- \
  --name=my-app \
  --platform=ios \
  --category=utilities \
  --bundle-id=com.example.myapp \
  --display-name="MyApp" \
  --description="사용자의 문제를 해결하는 앱 설명" \
  --hosting=netlify

npm run check-docs
npm run check-env -- --app=utilities/my-app --platform=ios
```

생성 후 `utilities/my-app/ROADMAP.md`를 먼저 실제 출시 범위에 맞게 수정합니다.

## 권장 AI 설정

토큰 사용량과 결과 품질의 균형을 위해 새 앱 개발 세션은 아래 설정을 기본으로 권장합니다.

- Claude Code: Claude Opus 4.x 최신 모델, thinking/reasoning `xhigh`, Don't Ask 모드
- Codex: GPT-5.x 최신 모델, reasoning `high`, Full Access Mode

회사 코드나 민감한 production repository에서는 권한 모드를 낮추고 승인 절차를 유지합니다.

## 공유용 프롬프트

앱 개발환경을 처음 세팅하는 사람에게는 [앱 개발환경 셋업 프롬프트](prompts/app-development-environment-setup.md)를
공유하면 됩니다. Claude Code나 Codex에 붙여넣으면 장비 점검, 템플릿 clone, 새 앱 생성,
ROADMAP 작성, 배포 환경변수 확인, 홈페이지 호스팅 선택까지 순서대로 진행하도록 설계되어 있습니다.

영상 설명란에 전체 대본을 함께 공유하려면 [앱 공장 개발환경 셋업 영상 스크립트](docs/video-script-app-factory.md)를
사용합니다.

## 구조

```
apps-template/
├── apps-deployment/        # iOS / macOS / Flutter 공통 배포 스크립트
├── .claude/skills/         # /new-app, /ios-deploy, /flutter-deploy, /macos-deploy
├── .codex/skills/          # Codex용 new-app, ios-deploy, flutter-deploy, macos-deploy skill
├── docs/                   # 공개 설명용 문서와 영상 스크립트
├── .github/workflows/      # 템플릿 자체 검증 CI
├── infra/                  # Netlify / Vercel / AWS 정적 페이지 호스팅 가이드
├── prompts/                # 공개 공유용 프롬프트
├── scripts/                # 새 앱 생성, 문서 검사, 환경변수 검사
└── templates/              # 앱 문서와 docs 페이지 템플릿
```

## 새 앱을 시작할 때

1. `node scripts/new-app.mjs`로 필요한 카테고리 디렉터리와 `<category>/<app-name>/` 디렉터리를 함께 만듭니다.
2. 생성된 `README.md`, `AGENTS.md`, `CLAUDE.md`, `ROADMAP.md`를 실제 앱 내용에 맞게 수정합니다.
3. `ROADMAP.md`를 먼저 작성하고, 목적 / 핵심 기능 / 디자인 원칙 / 개발 우선순위 / 출시 전 체크리스트를 계속 갱신합니다.
4. 정적 페이지가 필요하면 `<app>/docs/`에 `index.html`, `privacy.html` 등을 두고 `infra/`에서 Netlify, Vercel, AWS 중 하나를 선택합니다.
5. 배포가 필요하면 `<app>/deploy.config.sh`를 작성하고 `apps-deployment/` 스크립트나 Claude Code / Codex skill을 사용합니다.

카테고리 폴더는 템플릿 repo에 미리 만들지 않습니다. 실제 앱이 생길 때 필요한 분류만 추가합니다.

예:

```sh
node scripts/new-app.mjs \
  --name=my-app \
  --platform=ios \
  --category=utilities \
  --bundle-id=com.example.myapp \
  --display-name="MyApp" \
  --description="사용자의 문제를 해결하는 앱 설명" \
  --hosting=netlify
```

## 템플릿 검증

```sh
npm run check-docs
npm run check-env -- --app=utilities/my-app --platform=ios
npm run build-static-site -- --out=public-site
npm run ci
```

`check-env`는 배포 환경변수가 비어 있을 때 어디서 값을 확인하고 어떻게 `export`하거나
`deploy.config.sh`에 저장할지 안내합니다.

## 배포 설정

공통 기본값은 `apps-deployment/shared.config.sh`에 둡니다. 앱별 값은 각 앱의
`deploy.config.sh`에서 export합니다.

```sh
APPS_DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../apps-deployment" && pwd)"
export APPS_DEPLOY_DIR
source "$APPS_DEPLOY_DIR/shared.config.sh"

export ASC_BUNDLE_ID="com.example.myapp"
export ASC_APP_NAME="MyApp"
export PLAY_PACKAGE_NAME="com.example.myapp"
```

비밀 값은 repository 밖에 둡니다.

- App Store Connect: `~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8`
- Google Play: `~/.playconsole/<project>-sa.json`
- Android 서명: 로컬 keystore와 `key.properties`

## 정적 페이지 호스팅

`infra/`는 앱별 `docs/` 홈페이지를 공개하는 방법을 안내합니다.

- Netlify: `infra/netlify/README.md`
- Vercel: `infra/vercel/README.md`
- AWS: `infra/aws/README.md`

Terraform은 AWS를 선택한 경우에만 `infra/aws/`에서 사용합니다.

Netlify/Vercel 공유 site를 쓰는 경우 `npm run build-static-site -- --out=public-site`로
각 앱의 `docs/`를 `public-site/<app>/` 형태로 모을 수 있습니다.

## Claude Code / Codex 호환

루트와 각 앱 디렉터리는 `AGENTS.md`를 기준 문서로 사용하고, `CLAUDE.md`는 같은 디렉터리의
`AGENTS.md`를 참조합니다. Claude Code용 skill은 `.claude/skills/`, Codex용 skill은
`.codex/skills/`에 같은 이름으로 둡니다. 이렇게 두면 두 도구가 같은 작업 지침과 배포 흐름을
공유할 수 있습니다.

## 라이선스

0BSD 라이선스입니다. 재배포, 수정, 상업적 사용, 비공개 사용이 가능하며 소스 공개나 라이선스 고지 유지 의무가 없습니다.
