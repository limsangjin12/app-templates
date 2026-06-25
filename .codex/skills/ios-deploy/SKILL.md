---
name: ios-deploy
description: 현재 디렉터리의 네이티브 iOS 앱을 archive, export, App Store Connect 업로드까지 진행한다. 앱별 deploy.config.sh와 apps-deployment/ios/scripts를 사용한다.
---

# ios-deploy

## 전제

- 현재 디렉터리가 iOS 앱 루트다.
- `deploy.config.sh`가 있고 `ASC_BUNDLE_ID`, `ASC_APP_NAME`, `ASC_API_KEY`, `ASC_API_ISSUER`, `ASC_TEAM_ID`를 제공한다.
- App Store Connect `.p8` 키는 repo 밖에 있다.
- `ROADMAP.md`의 출시 전 체크리스트가 최신이다.

## 환경변수 누락 시 안내

필수 환경변수가 비어 있으면 배포를 바로 중단하고 설정 과정을 안내한다.

1. 현재 값 확인:
   ```sh
   source deploy.config.sh
   env | sort | grep -E '^(ASC_|IOS_|APPS_DEPLOY_DIR)'
   ```
2. App Store Connect 값 설정:
   ```sh
   export ASC_API_KEY="<KEY_ID>"
   export ASC_API_ISSUER="<ISSUER_ID>"
   export ASC_TEAM_ID="<TEAM_ID>"
   export ASC_BUNDLE_ID="com.example.myapp"
   export ASC_APP_NAME="MyApp"
   export IOS_SCHEME="MyApp"
   ```
3. `.p8` 파일 배치:
   ```sh
   mkdir -p "$HOME/.appstoreconnect/private_keys"
   mv AuthKey_<KEY_ID>.p8 "$HOME/.appstoreconnect/private_keys/"
   chmod 600 "$HOME/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8"
   ```
4. 반복 배포할 값은 `<app>/deploy.config.sh`에 저장한다. `.p8` 파일 본문은 repo에 넣지 않는다.

## 흐름

1. `source deploy.config.sh`
2. `project.yml` 또는 `*.xcodeproj`와 scheme을 확인한다.
3. `PrivacyInfo.xcprivacy`, 암호화 flag, AppIcon 1024px, 서명 설정을 확인한다.
4. 버전과 빌드 번호를 표시하고, 새 업로드면 빌드 번호 증가를 권장한다.
5. `"$APPS_DEPLOY_DIR/ios/scripts/deploy.sh"`를 실행한다.

## 표준 명령

```sh
source deploy.config.sh
"$APPS_DEPLOY_DIR/ios/scripts/deploy.sh" \
  --scheme "${IOS_SCHEME:-$ASC_APP_NAME}" \
  --project "${IOS_PROJECT:-${IOS_SCHEME:-$ASC_APP_NAME}.xcodeproj}" \
  --export-options "${IOS_EXPORT_OPTIONS:-ExportOptions.plist}" \
  --api-key "$ASC_API_KEY" \
  --api-issuer "$ASC_API_ISSUER"
```

## 실패 시 확인

- Archive 실패: 서명, provisioning profile, XcodeGen 생성물
- Export 실패: `ExportOptions.plist`, team id, provisioningProfiles
- Upload 실패: API key id, issuer id, key path, 네트워크 상태
- Missing Compliance: `ITSAppUsesNonExemptEncryption` 또는 App Store Connect 암호화 설정
