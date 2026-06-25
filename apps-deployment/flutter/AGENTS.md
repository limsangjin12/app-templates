# AGENTS.md — flutter 디렉터리

> Flutter 앱 배포 작업 시 참고 가이드. 사람용 문서는 `README.md`.

## 이 디렉터리의 목적

Flutter 앱을 Google Play + App Store 양쪽으로 배포하는 데 쓰는 공통 스크립트
+ 템플릿 + 체크리스트.

## 스크립트 작성 규칙

### 환경변수 우선
앱별 식별자 (PACKAGE_NAME / BUNDLE_ID / SA_KEY_PATH) 는 **반드시 환경변수**
로 받음. 하드코딩 금지. block-pang/gomoku 의 내장 스크립트는 앱 repo
안에서 자체 사용하는 사본 — 여기 (`apps-deployment/flutter/scripts/`) 는
범용 버전.

### 멱등성
한 번 더 실행해도 안전하게. 실패 시 부분 상태 남기지 않기.
- Play API edit는 commit 전에는 다른 edit와 충돌 가능 → `Edit has been deleted`
  에러 시 재실행으로 복구
- Play track release status는 commit 시 inherited 됨 → graphics-only edit도
  internal/alpha/beta 트랙을 명시적인 draft 상태로 PUT 한 뒤 commit

### 외부 의존성
- Node ≥ 18(fetch, ESM), `google-auth-library`, `jsonwebtoken`
- ImageMagick(feature graphic / 아이콘 생성)
- Flutter 3.41+, OpenJDK 17 (Android), Xcode 26+ (iOS)

## 디렉터리 구조

```
flutter/
├── scripts/      환경변수 기반 범용 배포 스크립트
├── templates/    앱마다 복사해서 쓰는 plist / properties / json
├── docs/         체크리스트, 트러블슈팅
├── README.md     사람이 읽는 사용법
└── AGENTS.md     본 문서
```

## 새 스크립트 추가 시

1. 환경변수로 모든 앱별 값 받기 (PACKAGE_NAME, BUNDLE_ID, SA_KEY_PATH 등)
2. 첫 줄 shebang + 위쪽에 사용법/필수 환경변수 주석 작성
3. 멱등하게 짜기 (재실행 안전)
4. README 의 "스크립트 일람" 표에 한 줄 추가

## 자주 잡힌 함정

- Play Console 첫 release가 draft 상태면 메타데이터/그래픽 edit가 commit 시
  "Only releases with status draft may be created on draft app" 에러 → graphics
  스크립트가 트랙 release를 명시적인 'draft' 상태로 다시 PUT 후 commit
- `--dry-run` 같은 boolean flag의 인자 파싱 — `[k, v ?? true]` 패턴 잊으면
  `args['dry-run']` 가 `undefined` 라 false 로 판정됨
- iPhone 17 Pro Max 1320×2868 은 ASC 기준 APP_IPHONE_67 (APP_IPHONE_69 아님)
- iPad Pro 13" M4 의 2064×2752 는 ASC 가 2048×2732 로 자동 크롭 (`sips -c`)
- `asc-cancel-submission.mjs` 는 `ASC_PLATFORM` 을 본다. macOS reviewSubmission lock 해제는 `ASC_PLATFORM=MAC_OS` 로 실행.
- SA 가 Play Console 앱에 초대되지 않으면 모든 API 가 403 — 초대 후 약 1분 대기
- iOS 배포는 별도 디렉터리 `ios/` 에 native iOS 전용 도구 (xcodebuild/altool) 가 있음.
  Flutter 에서도 iOS 빌드는 `flutter build ipa` 로 충분하지만 native iOS 앱이면
  `apps-deployment/ios/scripts/deploy.sh` 가 더 풍부함.

## Flutter 앱 repo 와 공유

각 Flutter 앱의 `scripts/` 디렉터리에 wrapper를 두고 본 디렉터리의 범용 스크립트를
호출하는 식이 깔끔. 또는 직접 `node .../apps-deployment/flutter/scripts/...mjs` 호출.

`.github/workflows/ci.yml` 도 본 디렉터리의 스크립트를 호출하는 식으로 짜면 앱마다
중복 작성 안 해도 됨.
