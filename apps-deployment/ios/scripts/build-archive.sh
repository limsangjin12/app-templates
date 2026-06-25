#!/usr/bin/env bash
# Archive an iOS app for App Store distribution.
#
# Usage:
#   build-archive.sh --scheme MyApp --project MyApp.xcodeproj \
#                    [--archive-path build/release/MyApp.xcarchive] \
#                    [--configuration Release]
#
# project.yml 이 있으면 xcodegen 을 먼저 실행한다.
# `xcodebuild` 출력은 길어서 마지막 5줄만 표시. 실패 시 전체 로그는
# `build/release/archive.log` 에 저장.

set -euo pipefail

SCHEME=""
PROJECT=""
ARCHIVE_PATH="build/release/App.xcarchive"
CONFIGURATION="Release"

usage() {
    sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --scheme)        SCHEME="$2"; shift 2 ;;
        --project)       PROJECT="$2"; shift 2 ;;
        --archive-path)  ARCHIVE_PATH="$2"; shift 2 ;;
        --configuration) CONFIGURATION="$2"; shift 2 ;;
        -h|--help)       usage 0 ;;
        *)               echo "[archive] unknown arg: $1" >&2; usage 1 ;;
    esac
done

if [[ -z "$SCHEME" || -z "$PROJECT" ]]; then
    echo "[archive] --scheme 와 --project 둘 다 필수" >&2
    usage 1
fi

if [[ -f "project.yml" ]]; then
    if ! command -v xcodegen >/dev/null 2>&1; then
        echo "[archive] project.yml 있는데 xcodegen 미설치. brew install xcodegen" >&2
        exit 1
    fi
    echo "[archive] xcodegen"
    xcodegen >/dev/null
fi

mkdir -p "$(dirname "$ARCHIVE_PATH")"
LOG="$(dirname "$ARCHIVE_PATH")/archive.log"

echo "[archive] $SCHEME ($CONFIGURATION) → $ARCHIVE_PATH"
if ! xcodebuild \
        -project "$PROJECT" \
        -scheme "$SCHEME" \
        -configuration "$CONFIGURATION" \
        -destination 'generic/platform=iOS' \
        -archivePath "$ARCHIVE_PATH" \
        -allowProvisioningUpdates \
        archive >"$LOG" 2>&1; then
    echo "[archive] 실패. 마지막 30줄:" >&2
    tail -30 "$LOG" >&2
    echo "[archive] 전체 로그: $LOG" >&2
    exit 1
fi

echo "[archive] OK → $ARCHIVE_PATH"
