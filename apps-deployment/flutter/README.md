# Flutter 배포

Android와 iOS용 Flutter 앱 배포 스크립트입니다.

## 설정

스크립트 의존성을 설치합니다.

```sh
cd apps-deployment/flutter/scripts
npm install
```

비밀 값은 repo 밖에 둡니다.

- App Store Connect API 키: `~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8`
- Google Play 서비스 계정 JSON: `~/.playconsole/<project>-sa.json`
- Android keystore와 `android/key.properties`: 로컬 전용

## 앱 `deploy.config.sh`

```sh
APPS_DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../apps-deployment" && pwd)"
export APPS_DEPLOY_DIR
source "$APPS_DEPLOY_DIR/shared.config.sh"

export PLAY_PACKAGE_NAME="com.example.myapp"
export PLAY_SA_KEY="$HOME/.playconsole/apps-sa.json"

export ASC_BUNDLE_ID="com.example.myapp"
export ASC_APP_NAME="MyApp"
export ASC_API_KEY="<KEY_ID>"
export ASC_API_ISSUER="<ISSUER_ID>"
export ASC_TEAM_ID="<TEAM_ID>"
```

## 환경변수 설정 가이드

Flutter 배포에는 Android/Play와 iOS/ASC 값이 모두 필요할 수 있습니다.

필수 값 확인:

```sh
source deploy.config.sh
env | sort | grep -E '^(PLAY_|ASC_|APPS_DEPLOY_DIR)'
```

누락된 값이 있으면 다음을 채웁니다.

- `PLAY_PACKAGE_NAME`: `android/app/build.gradle.kts`의 `applicationId`와 같아야 합니다.
- `PLAY_SA_KEY`: Play Console 권한이 있는 service account JSON 경로입니다.
- `ASC_BUNDLE_ID`: `ios/Runner.xcodeproj`의 `PRODUCT_BUNDLE_IDENTIFIER`와 같아야 합니다.
- `ASC_API_KEY`: App Store Connect API Key ID입니다.
- `ASC_API_ISSUER`: App Store Connect Issuer ID입니다.
- `ASC_TEAM_ID`: Apple Developer Team ID입니다.

일회성 실행:

```sh
export PLAY_PACKAGE_NAME="com.example.myapp"
export PLAY_SA_KEY="$HOME/.playconsole/apps-sa.json"
export ASC_BUNDLE_ID="com.example.myapp"
export ASC_API_KEY="<KEY_ID>"
export ASC_API_ISSUER="<ISSUER_ID>"
export ASC_TEAM_ID="<TEAM_ID>"
```

반복 배포할 앱은 이 값을 `<app>/deploy.config.sh`에 저장합니다. 단, `.p8`, service account JSON, keystore 본문은 저장하지 않습니다.

## 빌드

```sh
bash "$APPS_DEPLOY_DIR/flutter/scripts/build-android.sh" --aab-only
bash "$APPS_DEPLOY_DIR/flutter/scripts/build-ios.sh"
```

## 업로드

```sh
PLAY_PACKAGE_NAME="$PLAY_PACKAGE_NAME" \
PLAY_SA_KEY="$PLAY_SA_KEY" \
node "$APPS_DEPLOY_DIR/flutter/scripts/play-upload-bundle.mjs" \
  --bundle=build/app/outputs/bundle/release/app-release.aab \
  --track=internal
```

```sh
xcrun altool --upload-app -f build/ios/ipa/*.ipa --type ios \
  --apiKey "$ASC_API_KEY" \
  --apiIssuer "$ASC_API_ISSUER"
```
