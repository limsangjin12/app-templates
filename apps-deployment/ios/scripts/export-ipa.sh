#!/usr/bin/env bash
# Export an .ipa from an .xcarchive using ExportOptions.plist.
#
# Usage:
#   export-ipa.sh --archive-path PATH --export-options PATH \
#                 [--export-path build/release/export]

set -euo pipefail

ARCHIVE_PATH=""
EXPORT_OPTIONS=""
EXPORT_PATH="build/release/export"

usage() {
    sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --archive-path)   ARCHIVE_PATH="$2"; shift 2 ;;
        --export-options) EXPORT_OPTIONS="$2"; shift 2 ;;
        --export-path)    EXPORT_PATH="$2"; shift 2 ;;
        -h|--help)        usage 0 ;;
        *)                echo "[export] unknown arg: $1" >&2; usage 1 ;;
    esac
done

if [[ -z "$ARCHIVE_PATH" || -z "$EXPORT_OPTIONS" ]]; then
    echo "[export] --archive-path / --export-options 둘 다 필수" >&2
    usage 1
fi
[[ -d "$ARCHIVE_PATH" ]]   || { echo "[export] archive 없음: $ARCHIVE_PATH" >&2; exit 1; }
[[ -f "$EXPORT_OPTIONS" ]] || { echo "[export] ExportOptions.plist 없음: $EXPORT_OPTIONS" >&2; exit 1; }

mkdir -p "$EXPORT_PATH"
LOG="$EXPORT_PATH/export.log"

echo "[export] $ARCHIVE_PATH → $EXPORT_PATH"
if ! xcodebuild \
        -exportArchive \
        -archivePath "$ARCHIVE_PATH" \
        -exportOptionsPlist "$EXPORT_OPTIONS" \
        -exportPath "$EXPORT_PATH" \
        -allowProvisioningUpdates >"$LOG" 2>&1; then
    echo "[export] 실패. 마지막 30줄:" >&2
    tail -30 "$LOG" >&2
    echo "[export] 전체 로그: $LOG" >&2
    exit 1
fi

IPA="$(find "$EXPORT_PATH" -maxdepth 1 -name '*.ipa' | head -1)"
[[ -n "$IPA" ]] || { echo "[export] IPA 못 찾음" >&2; exit 1; }

echo "[export] OK → $IPA"
echo "$IPA"   # stdout 으로 IPA 경로 — 다음 단계에서 파이프 가능
