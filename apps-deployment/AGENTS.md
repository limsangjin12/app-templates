# AGENTS.md — apps-deployment

> 공통 배포 도구 디렉터리입니다. 여러 앱 monorepo에서 재사용할 수 있게 유지합니다.

## 범위

`apps-deployment/`에는 스크립트와 템플릿만 둡니다. 앱 소스 코드는 이 디렉터리에 넣지 않습니다.

## 규칙

- App Store Connect와 Google Play 작업은 공식 API를 우선 사용합니다.
- 스크립트는 환경변수 기반으로 작성합니다. 앱별 식별자는 `<app>/deploy.config.sh`에서 가져옵니다.
- 공통 기본값은 `shared.config.sh`에 두되, 개인 계정이나 private key를 하드코딩하지 않습니다.
- `.p8`, `.p12`, 서비스 계정 JSON, Android keystore, `key.properties`, 생성된 build artifact는 커밋하지 않습니다.
- 새 스크립트를 추가할 때는 파일 상단에 필요한 환경변수를 문서화합니다.
- 웹 콘솔 수동 단계가 불가피하면 API로 처리할 수 없는 이유를 함께 적습니다.

## 기대하는 앱 설정

```sh
APPS_DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../apps-deployment" && pwd)"
export APPS_DEPLOY_DIR
source "$APPS_DEPLOY_DIR/shared.config.sh"

export ASC_BUNDLE_ID="com.example.myapp"
export ASC_APP_NAME="MyApp"
export PLAY_PACKAGE_NAME="com.example.myapp"
```

## 검증

이 디렉터리 변경을 커밋하기 전 확인합니다.

- 의존성이 바뀐 script 폴더에서는 `npm install`을 실행합니다.
- 수정한 `.mjs` 파일은 `node --check`로 문법을 확인합니다.
- `shellcheck`가 있으면 수정한 shell script도 확인합니다.

