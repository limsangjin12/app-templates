# 정적 앱 페이지 인프라

앱 홈페이지와 개인정보처리방침을 공개할 호스팅 대상을 하나 선택합니다.

- **Netlify**: HTML 파일만 빠르게 공개하고 preview 배포가 필요할 때 가장 단순합니다.
- **Vercel**: 이후 Next.js나 frontend app으로 확장할 가능성이 있을 때 적합합니다.
- **AWS**: S3 website hosting을 Terraform으로 관리하고 싶을 때 사용합니다.

Terraform은 `infra/aws/`에만 있습니다. Netlify나 Vercel을 선택했다면 Terraform을 실행하지 않습니다.

## 공통 배치

각 앱의 공개 페이지는 앱 디렉터리 안에 둡니다.

```
<category>/<app>/docs/
├── index.html
└── privacy.html
```

`infra/scripts/apps-config.mjs`에는 App Store Connect, Google Play, OAuth helper script가 사용하는 공개 URL을 기록합니다.
호스팅 제공자와 URL 형식을 선택한 뒤 이 파일을 갱신합니다. helper의 `urls()` 함수로 URL을 자동 생성하려면
`APPS_WEB_BASE_URL`에 제공자 origin을 넣습니다.

## 호스팅 제공자 선택

### Netlify

`infra/netlify/README.md`를 사용합니다.

추천 상황:

- drag-and-drop 또는 Git 연동 static hosting을 쓰고 싶다.
- Terraform 없이 preview 배포를 쓰고 싶다.
- 각 앱이 `<category>/<app>/docs`에서 바로 publish될 수 있다.

### Vercel

`infra/vercel/README.md`를 사용합니다.

추천 상황:

- 이후 Next.js/frontend app으로 커질 가능성이 있다.
- Git 기반 preview 배포가 필요하다.
- 앱별 docs 폴더를 Vercel project 또는 route로 매핑해도 괜찮다.

### AWS

`infra/aws/README.md`를 사용합니다.

추천 상황:

- 하나의 S3 website bucket에 앱별 path prefix로 페이지를 모으고 싶다.
- 인프라 변경을 Terraform으로 추적하고 싶다.
- AWS credential과 bucket 이름 정책이 이미 있다.

## URL 자동화

`infra/scripts/`의 script는 특정 제공자에 묶이지 않습니다. 최종 공개 URL만 `apps-config.mjs`에 있으면 됩니다.

비밀 값은 repo 밖에 둡니다.

- App Store Connect API 키: `~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8`
- Google Play 서비스 계정 JSON: `~/.playconsole/<project>-sa.json`
- Search Console/OAuth script용 Google ADC: `gcloud auth application-default login`
