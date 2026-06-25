#!/usr/bin/env bash
# Release Android APK + AAB 빌드.
#
# 실행 위치: Flutter 프로젝트 루트 (pubspec.yaml 가 있는 곳)
# 또는 어느 위치에서든 --project=<path> 로 지정 가능.
#
# 사용법:
#   /path/to/apps-deployment/flutter/scripts/build-android.sh           # APK + AAB
#   /path/to/apps-deployment/flutter/scripts/build-android.sh --apk-only
#   /path/to/apps-deployment/flutter/scripts/build-android.sh --aab-only
#   /path/to/apps-deployment/flutter/scripts/build-android.sh --project=/path/to/app

set -euo pipefail

export PATH="/opt/homebrew/opt/openjdk@17/bin:/opt/homebrew/bin:$PATH"

mode=both
project="$PWD"
for arg in "$@"; do
  case "$arg" in
    --apk-only) mode=apk ;;
    --aab-only) mode=aab ;;
    --project=*) project="${arg#--project=}" ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

if [ ! -f "$project/pubspec.yaml" ]; then
  echo "❌ pubspec.yaml not found at $project" >&2
  exit 1
fi

cd "$project"
flutter pub get

case "$mode" in
  apk) flutter build apk --release ;;
  aab) flutter build appbundle --release ;;
  both) flutter build apk --release && flutter build appbundle --release ;;
esac

echo
echo "=== Outputs ==="
ls -lah build/app/outputs/flutter-apk/*.apk 2>/dev/null || true
ls -lah build/app/outputs/bundle/release/*.aab 2>/dev/null || true
