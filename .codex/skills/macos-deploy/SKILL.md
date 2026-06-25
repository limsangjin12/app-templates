---
name: macos-deploy
description: 현재 디렉터리의 네이티브 macOS 앱을 archive, pkg export, App Store Connect 업로드까지 진행한다. 앱별 deploy.config.sh와 apps-deployment/macos/scripts를 사용한다.
---

# macos-deploy

## 전제

- 현재 디렉터리가 macOS 앱 루트다.
- `deploy.config.sh`가 있고 `ASC_BUNDLE_ID`, `ASC_APP_NAME`, `ASC_API_KEY`, `ASC_API_ISSUER`, `ASC_TEAM_ID`를 제공한다.
- App Store 배포 앱은 App Sandbox를 켠다.
- `ROADMAP.md`의 출시 전 체크리스트가 최신이다.

## 환경변수 누락 시 안내

필수 환경변수가 비어 있으면 배포를 바로 중단하고 설정 과정을 안내한다.

1. 현재 값 확인:
   ```sh
   source deploy.config.sh
   env | sort | grep -E '^(ASC_|MACOS_|APPS_DEPLOY_DIR)'
   ```
2. App Store Connect 값 설정:
   ```sh
   export ASC_API_KEY="<KEY_ID>"
   export ASC_API_ISSUER="<ISSUER_ID>"
   export ASC_TEAM_ID="<TEAM_ID>"
   export ASC_BUNDLE_ID="com.example.myapp"
   export ASC_APP_NAME="MyApp"
   export MACOS_SCHEME="MyApp"
   ```
3. `.p8` 파일은 `~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8`에 두고 `chmod 600`을 적용한다.
4. 반복 배포할 값은 `<app>/deploy.config.sh`에 저장한다. private key 본문은 repo에 넣지 않는다.

## 흐름

1. `source deploy.config.sh`
2. `project.yml` 또는 `*.xcodeproj`와 scheme을 확인한다.
3. App Sandbox, entitlements, AppIcon, 서명 설정을 확인한다.
4. 버전과 빌드 번호를 확인한다.
5. `"$APPS_DEPLOY_DIR/macos/scripts/deploy.sh"`를 실행한다.

## 표준 명령

```sh
source deploy.config.sh
"$APPS_DEPLOY_DIR/macos/scripts/deploy.sh" \
  --scheme "${MACOS_SCHEME:-$ASC_APP_NAME}" \
  --project "${MACOS_PROJECT:-${MACOS_SCHEME:-$ASC_APP_NAME}.xcodeproj}" \
  --export-options "${MACOS_EXPORT_OPTIONS:-ExportOptions.plist}" \
  --api-key "$ASC_API_KEY" \
  --api-issuer "$ASC_API_ISSUER"
```

## 실패 시 확인

- Archive 실패: 서명, provisioning, sandbox entitlement
- Export 실패: `ExportOptions.plist` method와 provisioningProfiles
- Upload 실패: `.pkg` 산출물, API key, issuer, key path 확인
