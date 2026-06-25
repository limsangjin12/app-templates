# iOS App Store 제출 체크리스트

## 코드

- [ ] Bundle ID 확정 및 등록
- [ ] Display name 필요 locale에 맞게 설정
- [ ] Marketing version과 build number 설정
- [ ] 권한 사용 문구가 구체적이고 정확함
- [ ] 필요한 경우 `ITSAppUsesNonExemptEncryption` 설정
- [ ] `PrivacyInfo.xcprivacy` 포함 및 실제 동작과 일치
- [ ] AppIcon에 alpha 없는 1024x1024 PNG 포함
- [ ] Launch screen 정상 동작

## 서명

- [ ] Apple Developer Program 멤버십 활성
- [ ] App ID 존재
- [ ] Distribution certificate/profile 준비
- [ ] App Store Connect API 키를 repo 밖에 보관
- [ ] `ExportOptions.plist` 앱에 맞게 수정

## App Store Connect

- [ ] 앱 레코드 생성
- [ ] 카테고리, 연령 등급, 가격, 배포 국가 설정
- [ ] App Privacy 답변이 runtime 동작과 일치
- [ ] 지원, marketing, privacy URL 접근 가능
- [ ] 필요한 기기/locale screenshot 업로드
- [ ] 필요 시 review note와 demo 계정 준비

## 업로드

```sh
source deploy.config.sh
"$APPS_DEPLOY_DIR/ios/scripts/deploy.sh" \
  --scheme "$IOS_SCHEME" \
  --project "$IOS_PROJECT" \
  --export-options "${IOS_EXPORT_OPTIONS:-ExportOptions.plist}" \
  --api-key "$ASC_API_KEY" \
  --api-issuer "$ASC_API_ISSUER"
```

## TestFlight

- [ ] build 처리 완료
- [ ] internal testing 그룹에 build 배포
- [ ] 실제 기기 설치 확인
- [ ] `ROADMAP.md` 출시 체크리스트 갱신
