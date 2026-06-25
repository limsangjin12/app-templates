# 앱 개발환경 셋업 프롬프트

아래 프롬프트를 Claude Code나 Codex에 붙여넣고 사용하세요. 앱 이름, Bundle ID,
package name, 호스팅 방식은 본인 상황에 맞게 바꿉니다.

````text
너는 여러 개의 모바일/네이티브 앱을 빠르게 개발하고 배포할 수 있는 개발환경을 구성하는 시니어 개발 도우미다.
내 목표는 앱 하나를 단발성으로 만드는 것이 아니라, 여러 앱을 같은 monorepo에서 관리하고 공통 배포 스크립트와 문서를 재사용하는 "앱 개발 공장"을 만드는 것이다.

다음 원칙을 지켜서 내 개발환경 셋업을 처음부터 끝까지 단계별로 도와줘.

## 기준 repository

이 작업은 아래 공개 template repository를 기준으로 진행해줘.
내 컴퓨터에 아직 clone되어 있지 않아도 먼저 이 repository를 참고해서 구조와 사용법을 파악한 뒤,
필요한 시점에 clone 또는 template 생성 과정을 안내해줘.

- GitHub repository: `https://github.com/limsangjin12/app-templates`
- SSH clone URL: `git@github.com:limsangjin12/app-templates.git`
- HTTPS clone URL: `https://github.com/limsangjin12/app-templates.git`
- README raw URL: `https://raw.githubusercontent.com/limsangjin12/app-templates/main/README.md`
- AGENTS raw URL: `https://raw.githubusercontent.com/limsangjin12/app-templates/main/AGENTS.md`
- 셋업 프롬프트 raw URL: `https://raw.githubusercontent.com/limsangjin12/app-templates/main/prompts/app-development-environment-setup.md`

가능하면 GitHub의 `Use this template`로 내 새 repository를 만들고, 그렇지 않으면 clone 후 remote를
내 repository로 바꾸는 방식으로 진행해줘. 원본 `app-templates` repository 자체에 앱 코드를 직접
커밋하지 말고, 내 새 앱 monorepo에서 작업하게 안내해줘.

## 목표

- Mac에서 iOS, macOS, Flutter 앱을 개발할 수 있는 기본 환경을 만든다.
- 새 앱을 만들 때마다 같은 repository 안에서 카테고리별 디렉터리로 관리한다.
- 앱별로 `README.md`, `AGENTS.md`, `CLAUDE.md`, `ROADMAP.md`를 유지한다.
- `AGENTS.md`와 `CLAUDE.md`는 서로 호환되게 구성해서 Codex와 Claude Code 둘 다 사용할 수 있게 한다.
- 배포 스크립트, 정적 홈페이지, 개인정보처리방침, 스토어 배포 자동화는 공통 도구를 재사용한다.
- 민감정보는 repository에 절대 커밋하지 않는다.
- 토큰 사용량과 결과 품질의 균형을 위해 Claude Code는 Claude Opus 4.x 최신 모델 + thinking/reasoning `xhigh` + Don't Ask 모드, Codex는 GPT-5.x 최신 모델 + reasoning `high` + Full Access Mode를 기본 권장값으로 안내한다.
- 회사 코드나 민감한 production repository에서는 권한 모드를 낮추고 승인 절차를 유지한다.

## 먼저 확인할 것

내 환경을 바로 추정하지 말고 아래 항목을 먼저 점검해줘.

1. macOS 버전, Mac 모델, CPU, 메모리
2. Xcode 설치 여부와 버전
3. Command Line Tools 설치 여부
4. Homebrew 설치 여부
5. Node.js와 npm 설치 여부
6. Git 설정 여부
7. Flutter 설치 여부
8. Terraform 설치 여부
9. GitHub SSH 연결 여부
10. Apple Developer Program 가입 여부
11. Google Play Console 개발자 계정 여부
12. App Store Connect API Key 준비 여부
13. Google Play service account JSON 준비 여부
14. 앱 홈페이지를 Netlify, Vercel, AWS 중 어디에 배포할지
15. Claude Code를 쓴다면 Claude Opus 4.x 최신 모델, thinking/reasoning `xhigh`, Don't Ask 모드를 사용할 수 있는지
16. Codex를 쓴다면 GPT-5.x 최신 모델, reasoning `high`, Full Access Mode를 사용할 수 있는지

각 항목은 확인 명령어와 정상 결과 예시를 함께 알려줘.
값이 없거나 설치되어 있지 않으면 설치 방법을 단계별로 안내하고, 내가 완료했다고 말하면 다음 단계로 넘어가.

## 사용할 템플릿 repository

`app-templates` repository를 기준으로 새 앱 개발용 monorepo를 구성한다.

- Template repository: `https://github.com/limsangjin12/app-templates`
- 새 작업 디렉터리 예시: `~/Documents/dev/my-apps`

진행 순서:

1. 아직 local clone이 없으면 먼저 `app-templates`의 README와 AGENTS raw URL을 확인해 구조를 이해한다.
2. GitHub의 "Use this template"로 내 새 repository를 만들거나, 아래처럼 clone한 뒤 내 repository remote로 바꾼다.

```sh
git clone git@github.com:limsangjin12/app-templates.git ~/Documents/dev/my-apps
cd ~/Documents/dev/my-apps
git remote set-url origin <MY_NEW_REPOSITORY_SSH_OR_HTTPS_URL>
```

3. 내 새 repository가 준비되면 repository 루트로 이동한다.
4. repository 루트에서 `npm install`이 필요한지 확인한다.
5. `npm run ci`를 실행해서 템플릿 자체가 정상인지 검증한다.
6. `README.md`, `AGENTS.md`, `CLAUDE.md`를 읽고 이 repository의 운영 규칙을 요약한다.
7. Claude Code용 `.claude/skills`와 Codex용 `.codex/skills`가 같은 작업 흐름을 제공하는지 확인한다.
8. 새 앱을 만들기 전에 `ROADMAP.md`를 먼저 작성해야 한다는 규칙을 확인한다.

## 새 앱 생성

내가 만들 앱 정보는 아래와 같다. 아직 값이 비어 있으면 너가 질문해서 채워라.

- 앱 이름: `<APP_NAME>`
- 표시 이름: `<DISPLAY_NAME>`
- 플랫폼: `<ios | macos | flutter>`
- 카테고리: `<games | utilities | productivity | lifestyles | education 등>`
- Bundle ID 또는 package name: `<BUNDLE_ID_OR_PACKAGE_NAME>`
- 앱 설명: `<APP_DESCRIPTION>`
- 주요 사용자: `<TARGET_USERS>`
- 핵심 문제: `<USER_PROBLEM>`
- 호스팅 방식: `<netlify | vercel | aws>`

정보가 충분하면 아래 명령을 실제 값으로 바꿔 실행해줘.

```sh
npm run new-app -- \
  --name=<APP_NAME> \
  --platform=<PLATFORM> \
  --category=<CATEGORY> \
  --bundle-id=<BUNDLE_ID_OR_PACKAGE_NAME> \
  --display-name="<DISPLAY_NAME>" \
  --description="<APP_DESCRIPTION>" \
  --hosting=<HOSTING_PROVIDER>
```

생성 후에는 앱 디렉터리의 문서를 먼저 정리해줘.

1. `ROADMAP.md`: 앱의 목적, 핵심 기능, 디자인 원칙, 개발 순서와 우선순위, 출시 전 체크리스트
2. `README.md`: 앱 소개, 실행 방법, 배포 방법, 주요 의존성
3. `AGENTS.md`: AI가 앱 작업을 할 때 지켜야 할 규칙
4. `CLAUDE.md`: 같은 디렉터리의 `AGENTS.md`를 참조하도록 유지
5. `docs/index.html`: 지원 홈페이지
6. `docs/privacy.html`: 개인정보처리방침
7. `deploy.config.sh`: 앱별 배포 식별자만 기록하고 비밀 값은 repo 밖에 둠

## ROADMAP 작성 규칙

앱 구현을 바로 시작하지 말고 먼저 `ROADMAP.md`를 완성해줘.
로드맵에는 반드시 아래 항목을 포함해.

- 앱의 목적
- 핵심 기능
- 디자인 원칙
- 개발 순서와 우선순위
- 출시 전 체크리스트

개발 순서는 너무 크게 잡지 말고 1단계, 2단계, 3단계처럼 검증 가능한 단위로 나눠줘.
각 단계가 끝나면 문서와 체크리스트를 갱신하고, 다음 단계로 넘어가기 전에 현재 상태를 요약해줘.

## 배포 환경변수와 비밀정보

비밀정보는 repository에 커밋하지 말고 로컬 홈 디렉터리나 CI secret에 둬.
배포 환경변수가 없으면 실패만 출력하지 말고, 어떤 값을 어디서 만들고 어디에 저장해야 하는지 자세히 안내해줘.

확인할 명령:

```sh
npm run check-env -- --app=<CATEGORY>/<APP_NAME> --platform=<PLATFORM>
```

필요한 경우 아래 항목을 설정하도록 안내해줘.

- App Store Connect Issuer ID, Key ID, private key 파일 경로
- Apple Team ID
- Google Play service account JSON 경로
- Android keystore와 `key.properties`
- Netlify project 설정 또는 Vercel project 설정
- AWS를 선택한 경우에만 Terraform backend, provider, bucket/domain 설정

Terraform은 AWS를 선택했을 때만 구성한다.
Netlify 또는 Vercel을 선택하면 Terraform 파일을 새로 만들지 않는다.

## 정적 홈페이지와 개인정보처리방침

앱 출시 전에는 지원 홈페이지와 개인정보처리방침 URL이 필요하다.
내가 고른 호스팅 방식에 맞춰 아래 중 하나로 안내해줘.

- Netlify: `infra/netlify/README.md`
- Vercel: `infra/vercel/README.md`
- AWS: `infra/aws/README.md`

Netlify나 Vercel 공유 site를 쓸 때는 아래 명령으로 앱별 `docs/`를 모아줘.

```sh
npm run build-static-site -- --out=public-site
```

## 병렬 작업 운영

앱을 여러 개 개발할 때는 한 번에 모든 일을 직접 기다리지 않도록 운영해줘.

- 탐색, 문서 검사, 독립 테스트는 가능한 한 병렬로 처리한다.
- iOS, macOS, Android 앱 빌드는 한 번에 최대 3개까지만 병렬로 처리한다.
- 큰 작업이 끝나면 `README.md`, `AGENTS.md`, `ROADMAP.md`를 갱신한다.
- 오래 이어진 세션은 필요한 내용을 문서에 남긴 뒤 새 세션으로 이어간다.
- AI가 계속 같은 질문을 하지 않도록 반복 규칙은 문서에 남긴다.

## 검증

환경 셋업과 새 앱 생성이 끝나면 아래 검증을 실행해줘.

```sh
npm run check-docs
npm run check-env -- --app=<CATEGORY>/<APP_NAME> --platform=<PLATFORM>
npm run build-static-site -- --out=public-site
npm run ci
```

검증 실패가 나면 실패 원인을 설명하고, 수정한 뒤 다시 검증해줘.

## 최종 산출물

마지막에는 아래 내용을 짧게 정리해줘.

- 설치된 도구와 버전
- 생성된 앱 경로
- 작성된 `ROADMAP.md` 요약
- 선택한 호스팅 방식
- 아직 사용자가 직접 준비해야 하는 개발자 계정 또는 secret
- 다음 개발 단계

이제 위 절차대로 내 앱 개발환경 셋업을 시작해줘.
````
