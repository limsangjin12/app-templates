# Flutter 배포 트러블슈팅

block-pang / gomoku 작업 중 실제로 잡힌 케이스 모음.

## Android

### "Only releases with status draft may be created on draft app"
Play Console에 첫 release가 아직 publish되지 않은 draft 상태에서 메타데이터/그래픽
edit를 commit하면 발생. 해결: edit commit 직전에 internal/alpha/beta 트랙의
release status를 명시적인 draft 상태로 PUT해서 inherited 상태를 명시.
`play-upload-graphics.mjs` 가 자동으로 처리.

### "The caller does not have permission" (403)
SA가 해당 앱에 초대되지 않음. Play Console → 사용자 및 권한 → SA 이메일 초대.
초대 후 약 1분 내에 권한 적용. 권한은 최소 "Release manager + Store listing"입니다.

### "Edit has been deleted" (400)
Play API 의 edit 가 동시에 다른 edit 와 충돌하면 자동 삭제됨. 재시도 시 새 edit 생성.
스크립트가 멱등하게 짜여있으면 그냥 다시 실행.

### `Release app bundle failed to strip debug symbols`
경고일 뿐 빌드는 성공. AAB 파일은 정상. 무시 가능.

### `keystore file not set for signing config release`
`android/key.properties` 미작성 또는 `build.gradle.kts` 가 로드 안 함.
templates/key.properties.example 참고.

### Play Games Services achievement/leaderboard ID 가 iOS와 다름
iOS는 vendor ID(`com.example.achievement.foo`) 그대로 사용 가능, Android는 자동 생성된
hash ID(`CgkI...`)만 받음. `flutter/scripts/play-set-games-config.mjs`가 업적/리더보드를 일괄 등록하고 hash ID를 출력해줌. 코드에 복붙. `games_services` 패키지의 Achievement/Score 객체는 androidID/iOSID 둘 다 받음.

### Play Games "Locale ... is not supported by the application"
Play Games Services 앱에 지원 언어가 등록 안 됨. Play Console → Play Games Services → 게임 → Properties → Languages 에서 `en-US`, `ko-KR`, `ja-JP`, `zh-CN`, `zh-TW` 추가. 그 후 다시 등록.

### Play Games "Locale invalid" — locale 코드 형식
Play Games Services는 **하이픈** 형식 (`en-US`, `ko-KR`, `ja-JP`, `zh-CN`, `zh-TW`). 공식 문서엔 underscore (`en_US`) 라고 쓰여있는 경우가 있지만 실제 API 는 하이픈만 받음. ASC 의 zh-Hans/zh-Hant 와도 다름 (Play는 zh-CN/zh-TW).

### Play Games "API has not been used in project"
SA의 Cloud project에서 "Google Play Games Services Publishing API"가 비활성. https://console.cloud.google.com/apis/library/gameservices.googleapis.com?project=<id> 에서 Enable. propagation 1-2분.

## iOS

### Game Center: 트로피/리더보드 IconButton 무반응 또는 "로그인 필요" SnackBar 무한 반복
구현 측 가장 흔한 함정. `games_services` 플러그인의 `GamesServices.signIn()` 은 두 가지 success 경로를 가진다:
- 첫 인증 성공 → `null` 또는 `""` 반환
- **이미 인증된 상태에서 재호출** → `"Player already authenticated"` 문자열 반환

`null` / 빈 문자열 만 success 로 처리하면 두 번째 경로가 항상 실패로 보여서 트로피 진입이 막힘. fix:
```dart
final ok = result == null ||
    result.isEmpty ||
    result.toLowerCase().contains('already authenticated');
```

진단 팁: 실패 시 SnackBar 에 `result` 문자열을 그대로 노출시켜 두면 사용자가 어떤 경로인지 즉시 회신 가능 (`[Player already authenticated]` vs `[The requested operation could not be completed because local player has not been authenticated.]` 등 의미가 정반대).

### Game Center: ASC version에 attach 안 되어 TestFlight에서 작동하지 않음
`gameCenterDetail` 만 만들어두면 부족. 각 `appStoreVersion` 마다 `gameCenterAppVersion` 을 생성해서 attach 해야 한다. `appStoreVersion` 만 relationship 으로 넘기면 됨 (gameCenterDetail 은 implicit):
```js
POST /v1/gameCenterAppVersions
{ data: { type: 'gameCenterAppVersions',
    relationships: { appStoreVersion: { data: { type:'appStoreVersions', id } } } } }
```
응답의 `attributes.enabled: true` 확인.

### `Missing Compliance` 경고 (TestFlight)
`Info.plist` 의 `ITSAppUsesNonExemptEncryption=false` 누락. 추가 후 재빌드.

### `(version, build) already exists`
같은 (`MARKETING_VERSION`, `CURRENT_PROJECT_VERSION`) 조합으로 다시 업로드. `pubspec.yaml`
의 `version: 1.0.0+N` 에서 `+N` 증가 후 재빌드.

### `Pod install` 실패 (GTMSessionFetcher 등 충돌)
`ios/Podfile.lock` 삭제 후 `pod install --repo-update`. games_services 같은 플러그인이
업데이트되면 자주 발생.

### IPA 업로드 후 TestFlight 에 안 보임
- App Store Connect 에 앱 레코드 없음 → 첫 업로드는 앱 레코드 생성 필요
- Apple 측 처리 ~10–30분 대기
- "Missing Compliance" 미해결 시 TestFlight 배포 보류

### 스크린샷이 ASC 에 거절됨 ("size not allowed")
iPhone 17 Pro Max 의 1320×2868 은 APP_IPHONE_67 로 분류. 1290×2796 (iPhone 14/15 Pro Max)
도 같은 슬롯. iPad Pro 13" M4 의 2064×2752 는 자동 크롭이 필요할 수 있음 (`sips -c 2732 2048`).

## Flutter / 빌드 일반

### `flutter test` 가 "Test directory not found"
cwd 가 프로젝트 루트가 아님. `cd <project root>` 후 재실행.

### 통합 테스트에서 드래그가 안 닿음
첫 실행 튜토리얼 다이얼로그가 가림. SharedPreferences mock 에 `<app>.tutorial_seen: true`
추가 필수.

### Riverpod async gap 에러
GameController/Notifier 안에서 `ref.read` 를 await 전에 capture. await 후 `if (!ref.mounted) return`.

### Audio init 실패 (테스트 환경)
audioplayers backend 없음. SoundService(prefs, playable: false) 로 override.

## ARB / l10n

### 새 ARB key 추가 후 build 실패
`flutter pub get` → `flutter gen-l10n` (또는 build 시 자동) 으로 generated dart 파일
재생성. 5 locale 모두 같은 키 보유해야 함 (`scripts/check-arb.sh` 로 sync 검증).

### `Locale 'zh_TW' not supported`
`l10n.yaml` 의 `preferred-supported-locales` 에 명시. `MaterialApp.supportedLocales` 도 동일하게.

## Cloud / API

### ASC API "401 Unauthorized"
JWT 만료 (15m). `newToken()` 재호출. 또는 keyId / issuerId 오타.

### ASC API "404 Not Found" on `/apps?filter[bundleId]=...`
앱이 ASC 에 아직 등록 안 됨. 첫 IPA 업로드가 앱 레코드를 만들어주는 게 아니라, 그 전에
Connect UI 에서 앱 등록 필요.

### ASC `chmod 400 ~/.appstoreconnect/private_keys/` 경로 디렉터리 권한
디렉터리 자체가 `drw-` (no execute) 면 `altool` 이 안에 있는 .p8 도 못 읽음.
`chmod 700` 으로 디렉터리 권한 수정.
