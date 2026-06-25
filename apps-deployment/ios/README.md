# iOS 배포

네이티브 iOS 앱 배포 스크립트입니다.

## 설정

```sh
cd apps-deployment/ios/scripts
npm install
```

필요한 로컬 비밀 값:

- `~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8`
- Apple Developer 계정의 유효한 signing certificate와 provisioning profile

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
export IOS_SCHEME="MyApp"
```

## 환경변수 설정 가이드

iOS 배포에 필요한 값을 먼저 확인합니다.

```sh
source deploy.config.sh
env | sort | grep -E '^(ASC_|IOS_|APPS_DEPLOY_DIR)'
```

누락된 값은 아래에서 확인합니다.

- `ASC_API_KEY`: App Store Connect → Users and Access → Integrations → Keys의 Key ID
- `ASC_API_ISSUER`: 같은 화면의 Issuer ID
- `ASC_TEAM_ID`: Apple Developer 계정의 Team ID
- `ASC_BUNDLE_ID`: 앱 bundle id
- `ASC_APP_NAME`: App Store Connect 앱 이름 또는 archive scheme 이름
- `IOS_SCHEME`: `xcodebuild -list`에서 확인한 scheme

일회성 실행:

```sh
export ASC_API_KEY="<KEY_ID>"
export ASC_API_ISSUER="<ISSUER_ID>"
export ASC_TEAM_ID="<TEAM_ID>"
export ASC_BUNDLE_ID="com.example.myapp"
export ASC_APP_NAME="MyApp"
export IOS_SCHEME="MyApp"
```

`.p8` 파일은 아래 위치에 둡니다.

```sh
mkdir -p "$HOME/.appstoreconnect/private_keys"
mv AuthKey_<KEY_ID>.p8 "$HOME/.appstoreconnect/private_keys/"
chmod 600 "$HOME/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8"
```

반복 배포할 값은 `<app>/deploy.config.sh`에 저장합니다. `.p8` 파일 본문은 절대 repo에 넣지 않습니다.

## 배포

```sh
source deploy.config.sh
"$APPS_DEPLOY_DIR/ios/scripts/deploy.sh" \
  --scheme "$IOS_SCHEME" \
  --project "$IOS_SCHEME.xcodeproj" \
  --export-options ExportOptions.plist \
  --api-key "$ASC_API_KEY" \
  --api-issuer "$ASC_API_ISSUER"
```
