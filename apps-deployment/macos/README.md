# macOS 배포

네이티브 macOS 앱을 archive하고 `.pkg`로 export한 뒤 App Store Connect에 업로드하는 스크립트입니다.

## 앱 `deploy.config.sh`

```sh
APPS_DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../apps-deployment" && pwd)"
export APPS_DEPLOY_DIR
source "$APPS_DEPLOY_DIR/shared.config.sh"

export ASC_BUNDLE_ID="com.example.myapp"
export ASC_APP_NAME="MyApp"
export ASC_API_KEY="<KEY_ID>"
export ASC_API_ISSUER="<ISSUER_ID>"
export ASC_TEAM_ID="<TEAM_ID>"
export MACOS_SCHEME="MyApp"
```

## 환경변수 설정 가이드

필수 값 확인:

```sh
source deploy.config.sh
env | sort | grep -E '^(ASC_|MACOS_|APPS_DEPLOY_DIR)'
```

누락된 값은 아래에서 확인합니다.

- `ASC_API_KEY`: App Store Connect API Key ID
- `ASC_API_ISSUER`: App Store Connect Issuer ID
- `ASC_TEAM_ID`: Apple Developer Team ID
- `ASC_BUNDLE_ID`: macOS 앱 bundle id
- `ASC_APP_NAME`: App Store Connect 앱 이름
- `MACOS_SCHEME`: `xcodebuild -list`에서 확인한 scheme

일회성 실행:

```sh
export ASC_API_KEY="<KEY_ID>"
export ASC_API_ISSUER="<ISSUER_ID>"
export ASC_TEAM_ID="<TEAM_ID>"
export ASC_BUNDLE_ID="com.example.myapp"
export ASC_APP_NAME="MyApp"
export MACOS_SCHEME="MyApp"
```

`.p8` 파일은 repo 밖에 둡니다.

```sh
mkdir -p "$HOME/.appstoreconnect/private_keys"
mv AuthKey_<KEY_ID>.p8 "$HOME/.appstoreconnect/private_keys/"
chmod 600 "$HOME/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8"
```

## 배포

```sh
source deploy.config.sh
"$APPS_DEPLOY_DIR/macos/scripts/deploy.sh" \
  --scheme "$MACOS_SCHEME" \
  --project "$MACOS_SCHEME.xcodeproj" \
  --export-options ExportOptions.plist \
  --api-key "$ASC_API_KEY" \
  --api-issuer "$ASC_API_ISSUER"
```

