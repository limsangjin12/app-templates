#!/usr/bin/env bash
# Release iOS IPA 빌드 (App Store / TestFlight 제출용).
#
# 사전 준비:
#   - Flutter 프로젝트 루트에 ios/ExportOptions.plist 가 있어야 함
#     (없으면 apps-deployment/flutter/templates/ExportOptions.plist 복사 후 teamID 수정)
#
# 사용법:
#   /path/to/apps-deployment/flutter/scripts/build-ios.sh
#   /path/to/apps-deployment/flutter/scripts/build-ios.sh --project=/path/to/app

set -euo pipefail

export PATH="/opt/homebrew/bin:$PATH"

project="$PWD"
for arg in "$@"; do
  case "$arg" in
    --project=*) project="${arg#--project=}" ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

if [ ! -f "$project/pubspec.yaml" ]; then
  echo "❌ pubspec.yaml not found at $project" >&2
  exit 1
fi

cd "$project"

if [ ! -f ios/ExportOptions.plist ]; then
  echo "❌ ios/ExportOptions.plist 가 없습니다." >&2
  echo "   apps-deployment/flutter/templates/ExportOptions.plist 를 복사 후 <TEAM_ID> 수정." >&2
  exit 1
fi

flutter pub get
( cd ios && pod install --repo-update )
flutter build ipa --release --export-options-plist=ios/ExportOptions.plist

echo
echo "=== Outputs ==="
ls -lah build/ios/ipa/*.ipa 2>/dev/null || true
