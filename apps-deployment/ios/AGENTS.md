# AGENTS.md — iOS 배포 스크립트

> 네이티브 iOS 배포 도구입니다. 상위 `../AGENTS.md`도 함께 따릅니다.

## 스크립트 규칙

- Shell script는 `set -euo pipefail`을 사용합니다.
- `--scheme`, `--api-key`처럼 long-form 인자를 우선합니다.
- 가능한 경우 모든 스크립트가 환경변수와 CLI 인자를 모두 받게 합니다.
- 필수 환경변수는 파일 상단 주석에 문서화합니다.
- 임시 파일은 `mktemp -d`와 `trap`으로 정리합니다.
- 앱별 값은 이 디렉터리가 아니라 `<app>/deploy.config.sh`에서 가져옵니다.

## 템플릿

- `templates/ExportOptions.plist`: 앱에 복사한 뒤 placeholder를 교체합니다.
- `templates/PrivacyInfo.xcprivacy`: 데이터 수집/추적이 없는 앱의 기본 privacy manifest입니다.
- `templates/WidgetExtension-Info.plist`: XcodeGen 프로젝트에서 WidgetKit extension Info.plist가 필요할 때 사용합니다.

## 앱 설정 패턴

```sh
APPS_DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../apps-deployment" && pwd)"
export APPS_DEPLOY_DIR
source "$APPS_DEPLOY_DIR/shared.config.sh"

export ASC_BUNDLE_ID="com.example.myapp"
export ASC_APP_NAME="MyApp"
export ASC_BUNDLE_PROFILES="\
com.example.myapp=MyApp App Store Profile;\
com.example.myapp.widgets=MyApp Widgets App Store Profile"
export ASC_APP_GROUP="group.com.example.myapp"
export ASC_APP_GROUP_NAME="MyApp Group"
export ASC_APP_GROUP_BUNDLES="com.example.myapp com.example.myapp.widgets"
```

## 환경변수 누락 시 안내 원칙

배포 스크립트가 필수 환경변수 누락으로 실패하면 단순히 "env missing"만 출력하지 말고 다음을 안내합니다.

1. 어떤 환경변수가 빠졌는지 정확히 표시합니다.
2. 해당 값을 어디서 확인하는지 설명합니다.
3. 일회성 `export` 예시와 앱별 `deploy.config.sh`에 저장하는 예시를 함께 제공합니다.
4. private key나 service account JSON은 repo에 넣지 말고 로컬 secret 경로 또는 CI secret에 두라고 명시합니다.

예:

```sh
export ASC_API_KEY="<KEY_ID>"
export ASC_API_ISSUER="<ISSUER_ID>"
export ASC_TEAM_ID="<TEAM_ID>"
export ASC_BUNDLE_ID="com.example.myapp"
export ASC_APP_NAME="MyApp"
```

## 멀티 타겟 메모

- `asc-ensure-bundle-id.mjs`는 Developer Portal bundle identifier 생성을 도울 수 있습니다.
- App Group 생성과 bundle-to-group 연결은 API 권한에 따라 Apple Developer Portal 수동 설정이 필요할 수 있습니다.
- `asc-prep-build-multi.mjs`는 여러 bundle ID의 certificate와 provisioning profile을 생성하거나 재사용합니다.
- capability를 바꾸면 기존 profile이 stale 상태가 될 수 있으므로 profile을 다시 생성합니다.

## Screenshot

`take-screenshots.sh`는 앱이 launch argument로 특정 화면 진입을 받을 수 있다고 가정합니다.
shot 설정은 `<app>/deploy.config.sh`에 둡니다.

```sh
export IOS_SCHEME="MyApp"
export IOS_BUNDLE_ID="com.example.myapp"
export IOS_APP_NAME="MyApp"
export SCREENSHOT_LOCALES="en-US:en_US;ko:ko_KR"
export IOS_SCREENSHOT_SHOTS="\
iphone:1-home:-InitialTab home -SkipOnboarding
ipad:1-home:-InitialTab home -SkipOnboarding"
```

## 검증

- 수정한 `.mjs` 파일은 `node --check`로 확인합니다.
- `shellcheck`가 있으면 수정한 `.sh` 파일도 확인합니다.
- `README.md`와 `docs/checklist.md`가 실제 스크립트 동작과 맞는지 확인합니다.

