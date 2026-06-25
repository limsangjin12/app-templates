# Flutter 스토어 출시 체크리스트

## 최초 설정

### iOS

- [ ] App Store Connect API 키를 생성하고 repo 밖에 보관
- [ ] Issuer ID와 Team ID를 로컬 환경변수 또는 CI secret에 기록
- [ ] App Store Connect 앱 레코드 생성
- [ ] `ios/ExportOptions.plist`를 템플릿에서 복사해 앱에 맞게 수정
- [ ] 필요한 경우 `ios/Runner/Info.plist`에 `ITSAppUsesNonExemptEncryption=false` 설정
- [ ] 필요한 경우 `PrivacyInfo.xcprivacy` 포함

### Android

- [ ] Google Play 개발자 계정 준비
- [ ] 최종 package name으로 Play 앱 생성
- [ ] 선택한 Google Cloud 프로젝트에서 Android Publisher API 활성화
- [ ] 서비스 계정 JSON을 repo 밖에 저장. 예: `~/.playconsole/apps-sa.json`
- [ ] 서비스 계정을 Play 앱에 초대하고 release/store-listing 권한 부여
- [ ] release keystore를 repo 밖에 생성
- [ ] `android/key.properties`를 로컬에 만들고 gitignore 처리

## 매 release

- [ ] `pubspec.yaml` 버전과 build number 증가
- [ ] `flutter analyze` 통과
- [ ] `flutter test` 통과
- [ ] Android AAB 빌드 성공
- [ ] iOS IPA 빌드 성공
- [ ] 스토어 metadata가 현재 앱 동작과 일치
- [ ] screenshot이 최신이고 플랫폼 규격에 맞음
- [ ] 개인정보처리방침 URL 접근 가능
- [ ] Internal testing / TestFlight 설치 확인

