# 보안 정책

## 비밀 값 원칙

이 템플릿은 private key, service account JSON, keystore, `.env` 파일을 저장하지 않습니다.
새 앱을 만들 때도 비밀 값은 repo 밖의 로컬 경로나 CI secret store에 둡니다.

커밋하면 안 되는 예:

- App Store Connect `.p8`, `.p12`
- Google Play service account JSON
- Android keystore, `key.properties`
- `GoogleService-Info.plist`, `google-services.json`
- Terraform state, `.env*`

## 검사

변경 전후로 아래 명령을 실행합니다.

```sh
npm run check-sensitive
npm run ci
```

## 취약점 제보

이 템플릿 자체의 보안 문제를 발견하면 GitHub issue로 재현 방법과 영향 범위를 적어 제보합니다.
실제 secret이 포함된 로그나 파일은 issue에 첨부하지 마세요.

