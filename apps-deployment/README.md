# apps-deployment

앱 monorepo에서 재사용하는 공통 배포 스크립트 모음입니다.

이 디렉터리는 공식 API를 우선 사용하는 helper를 제공합니다.

- Flutter 앱: Android App Bundle 빌드, Google Play 업로드, iOS IPA 빌드, App Store Connect 업로드
- 네이티브 iOS 앱: archive, export, upload, TestFlight 설정
- 네이티브 macOS 앱: archive, `.pkg` export, upload

## 비밀 값 정책

비밀 값은 커밋하지 않습니다. 로컬 키 위치나 CI secret storage에 둡니다.

- App Store Connect 키: `~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8`
- Google Play 서비스 계정: `~/.playconsole/<project>-sa.json`
- Android keystore와 `key.properties`: 로컬 전용

`shared.config.sh`는 경로와 공개 식별자를 참조할 수 있지만, private key 본문은 포함하지 않습니다.

## 앱 설정 패턴

각 앱은 `deploy.config.sh`를 둡니다.

```sh
APPS_DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../apps-deployment" && pwd)"
export APPS_DEPLOY_DIR
source "$APPS_DEPLOY_DIR/shared.config.sh"

export ASC_BUNDLE_ID="com.example.myapp"
export ASC_APP_NAME="MyApp"
export PLAY_PACKAGE_NAME="com.example.myapp"
export SCREENSHOT_LOCALES="en-US"
```

그 다음 앱 디렉터리에서 플랫폼별 스크립트나 슬래시 스킬을 실행합니다.

## 환경변수가 설정되지 않았을 때

배포 스크립트가 `ASC_API_KEY`, `ASC_API_ISSUER`, `ASC_BUNDLE_ID`, `PLAY_PACKAGE_NAME`,
`PLAY_SA_KEY` 같은 값을 찾지 못하면 먼저 앱 디렉터리의 `deploy.config.sh`를 확인합니다.

### 1. 현재 값 확인

```sh
source deploy.config.sh
env | sort | grep -E '^(ASC_|PLAY_|IOS_|MACOS_|APPS_DEPLOY_DIR)'
```

필수 값이 비어 있으면 아래 순서로 채웁니다.

### 2. App Store Connect 값

- `ASC_API_KEY`: App Store Connect → Users and Access → Integrations → Keys의 Key ID
- `ASC_API_ISSUER`: 같은 화면의 Issuer ID
- `ASC_TEAM_ID`: Apple Developer team id
- `ASC_BUNDLE_ID`: 앱의 bundle id. 예: `com.example.myapp`
- `.p8` 파일: `~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8`

일회성 설정:

```sh
export ASC_API_KEY="<KEY_ID>"
export ASC_API_ISSUER="<ISSUER_ID>"
export ASC_TEAM_ID="<TEAM_ID>"
export ASC_BUNDLE_ID="com.example.myapp"
export ASC_APP_NAME="MyApp"
```

앱에 지속적으로 저장할 값은 `<app>/deploy.config.sh`에 둡니다. `.p8` 파일 본문은 절대 repo에 넣지 않습니다.

### 3. Google Play 값

- `PLAY_PACKAGE_NAME`: Play Console에 등록한 package name
- `PLAY_SA_KEY`: Android Publisher API 권한이 있는 service account JSON의 로컬 경로

일회성 설정:

```sh
export PLAY_PACKAGE_NAME="com.example.myapp"
export PLAY_SA_KEY="$HOME/.playconsole/apps-sa.json"
```

서비스 계정 JSON은 repo 밖에 두고 chmod를 제한합니다.

```sh
chmod 600 "$PLAY_SA_KEY"
```

### 4. 앱별 config에 저장

```sh
APPS_DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../apps-deployment" && pwd)"
export APPS_DEPLOY_DIR
source "$APPS_DEPLOY_DIR/shared.config.sh"

export ASC_API_KEY="<KEY_ID>"
export ASC_API_ISSUER="<ISSUER_ID>"
export ASC_TEAM_ID="<TEAM_ID>"
export ASC_BUNDLE_ID="com.example.myapp"
export ASC_APP_NAME="MyApp"

export PLAY_PACKAGE_NAME="com.example.myapp"
export PLAY_SA_KEY="$HOME/.playconsole/apps-sa.json"
```

개인별로 달라지는 값이나 CI secret은 shell profile, password manager, CI secret store에 두고 `deploy.config.sh`에서는 참조만 합니다.

## 스크립트 의존성 설치

```sh
cd apps-deployment/ios/scripts && npm install
cd ../../flutter/scripts && npm install
```

## 플랫폼별 문서

- Flutter: `flutter/README.md`
- iOS: `ios/README.md`
- macOS: `macos/scripts/`
