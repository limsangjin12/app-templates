# iOS 배포 트러블슈팅

자주 잡힌 케이스 + 해결법. 새 케이스 발견 시 추가.

## 빌드 / 업로드 단계

### `Missing Compliance` (TestFlight 노란 경고)

**원인**: `ITSAppUsesNonExemptEncryption` 미설정 → Apple 이 매 업로드 시 export
compliance 답변을 요구.

**해결**: `project.yml` (또는 Info.plist) 에 추가:
```yaml
INFOPLIST_KEY_ITSAppUsesNonExemptEncryption: NO
```
표준 암호화만 사용하는 앱은 NO. 비표준 암호화 사용 시 해당 항목 별도 신고
필요 (드물다).

### `(version, build) already exists`

App Store Connect 에 같은 `MARKETING_VERSION` + `CURRENT_PROJECT_VERSION`
조합이 이미 있어서 거절.

**해결**: `project.yml` 의 `CURRENT_PROJECT_VERSION` 증가시켜 새 archive.

### `Invalid Binary` 메일

업로드 후 처리 단계에서 reject. 이메일 본문에 사유가 명시됨.

자주 보이는 사유:
- 권한 사용 설명 누락 / 영어로만 작성
- AppIcon 1024×1024 누락 / alpha 채널 있음
- 64-bit 미지원 (이젠 거의 없음)
- 사용 금지 API 호출

### Archive 실패 — `No profiles for 'com.example.app' were found`

자동 코드사이닝이 디바이스 프로필을 찾지 못함.

**해결**:
- Xcode → Settings → Accounts → 본인 Apple ID가 등록되었는지 확인
- 프로젝트 → Signing & Capabilities → "Automatically manage signing" 체크
- `xcodebuild ... -allowProvisioningUpdates` 옵션 사용 (스크립트는 이미 포함)

### `Command line name "app-store" is deprecated`

Xcode 26+ 의 `xcodebuild -exportArchive` 가 ExportOptions.plist 의
`method = app-store` 에 대해 매번 deprecation 경고 출력. 동작은 하지만 향후
제거될 수 있음.

**해결**: ExportOptions.plist 에서

```xml
<key>method</key>
<string>app-store-connect</string>
```

로 변경. 템플릿 (`templates/ExportOptions.plist`) 은 이미 갱신.

## 런타임 (앱 자체)

### `dispatch_assert_queue_fail` SIGTRAP — PHPhotoLibrary

`@MainActor` 클래스 안에서 `PHPhotoLibrary.performChanges { }` 호출 시,
클로저가 MainActor 로 추론되는데 PhotoKit 은 자체 큐에서 호출 → 트랩.

**해결**: 해당 클래스를 `Sendable` (격리 없음) 로 변경:
```swift
final class PhotoLibraryService: Sendable {  // @MainActor 제거
    static let shared = PhotoLibraryService()
    func save(jpegData: Data) async throws { ... }
}
```

### `swift_task_isCurrentExecutorWithFlagsImpl` — PHImageManager 콜백

`PHImageManager.requestImage(...)`, `requestAVAsset(...)` 의 결과 핸들러를
`@MainActor` View 안의 `withCheckedContinuation` 으로 wrap 하면 동일한 트랩.

**해결**: wrapper 함수를 **파일 스코프 nonisolated** 함수로 분리. SwiftUI
View 인스턴스 메서드 안에 직접 두지 말 것.

```swift
// 파일 스코프 (View 바깥)
private func loadVideoURL(for asset: PHAsset) async -> URL? {
    await withCheckedContinuation { (cont: CheckedContinuation<URL?, Never>) in
        PHImageManager.default().requestAVAsset(forVideo: asset, options: opts) {
            avAsset, _, _ in
            cont.resume(returning: (avAsset as? AVURLAsset)?.url)
        }
    }
}
```

### Swift 6 — `sending 'exportSession' risks causing data races`

`AVAssetExportSession` 은 Sendable 이 아닌 클래스. iOS 18+/26+ 에서 export
진행률을 보려고 `states(updateInterval:)` 와 `export(to:as:)` 를 `async let`
이나 `Task {}` 로 병렬 실행하면 Swift 6 strict-concurrency 가 거부.

**해결**: `@unchecked Sendable` 박스로 우회. 동시 export/states 호출의
thread safety 는 Apple 이 보장.

```swift
private struct UnsafeSessionBox: @unchecked Sendable {
    let session: AVAssetExportSession
}

let box = UnsafeSessionBox(session: exportSession)
async let exportResult: Void = box.session.export(to: outputURL, as: .mov)
for await state in box.session.states(updateInterval: 0.2) {
    if case .exporting(let p) = state {
        onProgress(p.fractionCompleted)
    }
}
try await exportResult
```

`Task {}` 로 progress 옵저버를 띄우는 패턴은 closure 의 Sendable 추론이
실패해 `() async -> Void` 가 'sending' 으로 처리되며 같은 에러를 부른다.
구조적 동시성 (`async let`) + 박스 조합이 가장 깔끔.

### TestFlight 처리 끝났는데 빌드 안 보임

- 새로고침 (Connect 웹은 캐싱이 빡셈)
- TestFlight → 좌측 사이드바 "Builds" 또는 "iOS" 하위 확인
- 앱 레코드 자체가 미생성이면 IPA 가 매칭 실패 — `+ New App` 으로 생성 후
  10–30분 더 기다리거나 재업로드

## 디바이스 크래시 로그 끌어오기

```sh
# OldFilm 의 모든 .ips 리스트
xcrun devicectl device info files \
    --device <UDID> --domain-type systemCrashLogs 2>&1 | grep -i oldfilm

# 특정 파일 다운로드
xcrun devicectl device copy from \
    --device <UDID> --domain-type systemCrashLogs \
    --source OldFilm-2026-04-30-213023.ips \
    --destination /tmp/crash.ips
```

`.ips` 는 JSON. `"faultingThread"` 와 그 thread 의 `frames` 배열에 스택 트레이스.
앱 코드의 closure 가 보이면 거기서부터 추적.
