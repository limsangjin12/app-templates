---
name: flutter-deploy
description: 현재 디렉터리의 Flutter 앱을 Android 내부 테스트 트랙과 iOS TestFlight로 배포한다. 앱별 deploy.config.sh와 apps-deployment/flutter/scripts를 사용한다.
---

# /flutter-deploy

## 전제

- 현재 디렉터리가 Flutter 프로젝트 루트다.
- `deploy.config.sh`가 있고 `PLAY_PACKAGE_NAME`, `PLAY_SA_KEY`, `ASC_BUNDLE_ID`, `ASC_API_KEY`, `ASC_API_ISSUER`를 제공한다.
- Android keystore, Play 서비스 계정 JSON, ASC `.p8` 키는 repo 밖에 있다.
- `ROADMAP.md`의 출시 전 체크리스트가 최신이다.

## 환경변수 누락 시 안내

필수 환경변수가 비어 있으면 배포를 바로 중단하고 설정 과정을 안내한다.

1. 현재 값 확인:
   ```sh
   source deploy.config.sh
   env | sort | grep -E '^(PLAY_|ASC_|APPS_DEPLOY_DIR)'
   ```
2. Android/Play 값 설정:
   ```sh
   export PLAY_PACKAGE_NAME="com.example.myapp"
   export PLAY_SA_KEY="$HOME/.playconsole/apps-sa.json"
   ```
3. iOS/App Store Connect 값 설정:
   ```sh
   export ASC_BUNDLE_ID="com.example.myapp"
   export ASC_API_KEY="<KEY_ID>"
   export ASC_API_ISSUER="<ISSUER_ID>"
   export ASC_TEAM_ID="<TEAM_ID>"
   ```
4. 반복 배포할 값은 `<app>/deploy.config.sh`에 저장한다. `.p8`, service account JSON, keystore 본문은 repo에 넣지 않는다.

## 흐름

1. `source deploy.config.sh`
2. `pubspec.yaml`의 `version: x.y.z+N` 확인
3. Android `applicationId`와 iOS bundle id가 deploy config와 맞는지 확인
4. Android 서명과 iOS ExportOptions 확인
5. Android/iOS 빌드는 독립적으로 실행 가능하되, 전체 앱 빌드는 한 번에 최대 3개까지만 병렬 실행
6. 빌드 산출물을 Play internal track과 TestFlight에 업로드

## 표준 명령

```sh
source deploy.config.sh
bash "$APPS_DEPLOY_DIR/flutter/scripts/build-android.sh" --aab-only
bash "$APPS_DEPLOY_DIR/flutter/scripts/build-ios.sh"
```

```sh
node "$APPS_DEPLOY_DIR/flutter/scripts/play-upload-bundle.mjs" \
  --bundle=build/app/outputs/bundle/release/app-release.aab \
  --track=internal
```

```sh
xcrun altool --upload-app -f build/ios/ipa/*.ipa --type ios \
  --apiKey "$ASC_API_KEY" \
  --apiIssuer "$ASC_API_ISSUER"
```

## 옵션

- `--skip-android`: iOS만
- `--skip-ios`: Android만
- `--bump-build`: `pubspec.yaml` build number 증가
- `--with-metadata`: 스토어 listing metadata 동기화
- `--with-screenshots`: screenshot 업로드
