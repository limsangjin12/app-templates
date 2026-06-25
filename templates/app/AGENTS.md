# AGENTS.md — <앱 이름>

> Codex와 Claude Code가 이 앱에서 공유하는 작업 지침입니다. 사람용 안내는 `README.md`를 봅니다.

## 기본 정보

- 앱 이름:
- 플랫폼:
- Bundle ID / package name:
- 지원 환경:
- 정적 페이지:

## 개발 원칙

- 토큰 사용량과 결과 품질의 균형을 위해 Claude Code는 Claude Opus 4.x 최신 모델 + thinking/reasoning `xhigh` + Don't Ask 모드, Codex는 GPT-5.x 최신 모델 + reasoning `high` + Full Access Mode를 기본 권장값으로 사용한다.
- 큰 변경 전후로 `ROADMAP.md`를 확인하고 실제 진행 상태를 반영한다.
- 기능을 완료하면 `README.md`, `AGENTS.md`, `ROADMAP.md`가 현재 상태와 맞는지 확인한다.
- 비밀 값과 실제 사용자 데이터는 커밋하지 않는다.
- 배포는 `apps-deployment/`의 공통 스크립트를 우선 사용한다.

## 빌드 / 테스트

```sh
# 앱별 표준 빌드와 테스트 명령을 적습니다.
```

## 배포

```sh
# 예:
# source deploy.config.sh
# "$APPS_DEPLOY_DIR/ios/scripts/deploy.sh" ...
```
