# AGENTS.md — 앱 템플릿 monorepo

> Codex와 Claude Code가 이 repository에서 공유하는 운영 가이드입니다. 사람용 안내는 `README.md`를 봅니다.

## 저장소의 목적

이 repository는 여러 모바일/네이티브 앱을 한 곳에서 개발하기 위한 monorepo 템플릿입니다.
앱 소스와 민감정보는 포함하지 않고, 새 앱을 시작할 때 필요한 문서 템플릿, 배포 스크립트,
Netlify / Vercel / AWS 정적 페이지 호스팅 가이드, Claude Code / Codex skill 문서를 제공합니다.

```
apps-template/
├── apps-deployment/        # iOS / macOS / Flutter 공통 배포 도구
├── .claude/skills/         # Claude Code slash skill 문서
├── .codex/skills/          # Codex skill 문서
├── docs/                   # 공개 설명용 문서와 영상 스크립트
├── .github/workflows/      # 템플릿 자체 검증 CI
├── infra/                  # Netlify / Vercel / AWS 정적 페이지 호스팅 가이드
├── prompts/                # 공개 공유용 프롬프트
├── scripts/                # 새 앱 생성, 문서 검사, 환경변수 검사
└── templates/              # ROADMAP / README / AGENTS / docs 페이지 템플릿
```

## 작업 운영 규칙

- 토큰 사용량과 결과 품질의 균형을 위해 Claude Code는 Claude Opus 4.x 최신 모델 + thinking/reasoning `xhigh` + Don't Ask 모드, Codex는 GPT-5.x 최신 모델 + reasoning `high` + Full Access Mode를 기본 권장값으로 둔다.
- 회사 코드, 민감한 production repository, 외부 고객 데이터가 있는 작업에서는 권한 모드를 낮추고 승인 절차를 유지한다.
- 큰 작업을 완료하면 관련 앱의 `AGENTS.md`, `README.md`, `ROADMAP.md`와 루트 문서가 실제 상태를 반영하는지 확인한다.
- 큰 작업이 끝났고 검증까지 완료됐으면, 사용자 변경분과 섞이지 않게 diff를 확인한 뒤 커밋하고 푸시한다.
- 탐색, 파일 읽기, 독립 빌드/테스트처럼 서로 의존하지 않는 작업은 가능한 한 병렬로 처리한다.
- iOS / macOS / Android 앱 빌드는 한 번에 최대 3개까지만 병렬 실행한다. 그 이상은 큐처럼 나눠서 처리한다.
- 앱 소스 디렉터리 안에 별도 `.git` 디렉터리를 만들지 않는다. 이 monorepo가 모든 앱을 직접 관리한다.

## 새 앱 개발 원칙

새 앱을 만들 때는 앱 디렉터리에 반드시 다음 문서를 둔다.

- `README.md`: 사람용 소개, 빌드/실행, 배포, 주요 의존성
- `AGENTS.md`: Codex/Claude Code용 앱 단위 작업 지침
- `CLAUDE.md`: `AGENTS.md` 참조 문구로 호환 유지
- `ROADMAP.md`: 개발 전에 작성하고 구현 중 계속 갱신

`ROADMAP.md`에는 최소한 아래 항목을 포함한다.

- 앱의 목적
- 핵심 기능
- 디자인 원칙
- 개발 순서와 우선순위
- 출시 전 체크리스트

권장 시작점은 `templates/app/ROADMAP.md`입니다.

## 새 앱 추가 규칙

1. 카테고리 디렉터리(`games/`, `utilities/`, `productivity/` 등) 안에 `<app-name>/`으로 추가한다.
2. 템플릿 repo에는 빈 카테고리 폴더를 미리 두지 않는다. 실제 앱을 만들 때 필요한 카테고리만 새로 만든다.
3. 앱별 인프라는 만들지 않는다. 정적 페이지 호스팅 방식은 루트 `infra/`에서 Netlify, Vercel, AWS 중 하나로 통합한다.
4. Terraform은 AWS를 선택한 경우에만 `infra/aws/`에서 구성한다. Netlify/Vercel 선택 시 Terraform 파일을 추가하지 않는다.
5. 앱별 정적 페이지는 `<app>/docs/`에 둔다. 필요한 경우 선택한 hosting provider와 `infra/scripts/apps-config.mjs`에 등록한다.
6. 앱별 배포 식별자는 `<app>/deploy.config.sh`에 둔다. 비밀 값은 repo 밖의 로컬 키 저장 위치나 CI secret에 둔다.
7. 앱별 스토어 메타데이터는 `<app>/store-listings/`처럼 앱 디렉터리 아래에 둔다.

## 배포 원칙

App Store Connect / Google Play 관련 작업은 가능한 한 공식 API로 자동화한다.
웹 콘솔 클릭 안내는 공식 API가 지원하지 않거나 사람 검토가 필수인 경우에만 남긴다.

- App Store Connect 키는 `~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8` 또는 CI secret으로 관리한다.
- Google Play service account JSON은 `~/.playconsole/<project>-sa.json` 또는 CI secret으로 관리한다.
- Android keystore와 `key.properties`는 repo에 커밋하지 않는다.
- `apps-deployment/shared.config.sh`에는 경로와 식별자 기본값만 둔다. 실제 비밀 파일은 포함하지 않는다.

## 절대 커밋하지 않는 것

- `.p8`, `.p12`, `.mobileprovision`, `.jks`, `.keystore`
- `key.properties`, `GoogleService-Info.plist`, `google-services.json`
- service account JSON, `.env*`, Terraform state
- 사용자 개인 사진, 실제 고객 데이터, 스토어 심사에만 쓰는 비공개 fixture
- 앱 디렉터리 내부의 `.git`

## 자주 쓰는 흐름

### 개발환경 셋업 공유

처음 템플릿을 사용하는 사람에게는 `prompts/app-development-environment-setup.md`를 공유한다.
이 프롬프트는 장비/도구 점검, template repository 준비, 새 앱 생성, `ROADMAP.md` 작성,
배포 환경변수 확인, Netlify/Vercel/AWS 호스팅 선택을 순서대로 안내한다.
영상 설명란에 전체 대본을 함께 공유할 때는 `docs/video-script-app-factory.md`를 사용한다.

### 새 앱

1. Claude Code에서는 `/new-app`, Codex에서는 `new-app` skill 또는 `node scripts/new-app.mjs`로 필요한 카테고리와 `<category>/<app>/` 생성
2. `templates/app/ROADMAP.md`를 바탕으로 앱 목적과 출시 범위 작성
3. `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/index.html`, `docs/privacy.html` 작성
4. 필요 시 `infra/`에서 Netlify, Vercel, AWS 중 하나를 선택하고 공개 URL을 `infra/scripts/apps-config.mjs`에 반영
5. AWS를 선택한 경우에만 `cd infra/aws && terraform apply`
6. 앱별 `deploy.config.sh` 작성 후 Claude Code에서는 `/ios-deploy`, `/flutter-deploy`, `/macos-deploy`, Codex에서는 같은 이름의 skill 사용

### 템플릿 검증

1. `node scripts/check-docs.mjs` — Markdown 한국어 본문, `CLAUDE.md` 호환, 앱 문서 세트 확인
2. `node scripts/check-env.mjs --app=<category>/<app> --platform=<platform>` — 배포 환경변수와 secret 파일 경로 확인
3. `node infra/scripts/build-static-site.mjs --out=public-site` — Netlify/Vercel 공유 site용 정적 페이지 생성
4. `npm run ci` — 문서, JavaScript, shell, Terraform 포맷, 민감정보 패턴 검사

### 문서 호환

`CLAUDE.md`는 항상 같은 디렉터리의 `AGENTS.md`를 참조합니다. 앱 디렉터리에서도 같은 패턴을 유지해
Claude Code와 Codex가 같은 지침을 보게 합니다.

### Skill 호환

Claude Code용 skill은 `.claude/skills/<skill>/SKILL.md`, Codex용 skill은
`.codex/skills/<skill>/SKILL.md`에 둔다. 현재 두 위치에는 `new-app`, `ios-deploy`,
`flutter-deploy`, `macos-deploy`를 같은 이름으로 제공한다. 배포 흐름이나 필수 환경변수 규칙을
수정할 때는 두 위치의 skill을 함께 갱신한다.
