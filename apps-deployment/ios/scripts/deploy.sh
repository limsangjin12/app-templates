#!/usr/bin/env bash
# End-to-end iOS 배포: archive → export → upload.
#
# Usage:
#   deploy.sh --scheme MyApp --project MyApp.xcodeproj \
#             --export-options ExportOptions.plist \
#             [--api-key KEY_ID] [--api-issuer ISSUER_ID] \
#             [--archive-path build/release/App.xcarchive] \
#             [--export-path build/release/export] \
#             [--validate-only] [--skip-upload]
#
# 환경변수 fallback:
#   ASC_API_KEY      → --api-key
#   ASC_API_ISSUER   → --api-issuer
#   EXPORT_OPTIONS   → --export-options

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SCHEME=""
PROJECT=""
EXPORT_OPTIONS="${EXPORT_OPTIONS:-}"
API_KEY="${ASC_API_KEY:-}"
API_ISSUER="${ASC_API_ISSUER:-}"
ARCHIVE_PATH="build/release/App.xcarchive"
EXPORT_PATH="build/release/export"
VALIDATE_ONLY=0
SKIP_UPLOAD=0

usage() {
    sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --scheme)         SCHEME="$2"; shift 2 ;;
        --project)        PROJECT="$2"; shift 2 ;;
        --export-options) EXPORT_OPTIONS="$2"; shift 2 ;;
        --api-key)        API_KEY="$2"; shift 2 ;;
        --api-issuer)     API_ISSUER="$2"; shift 2 ;;
        --archive-path)   ARCHIVE_PATH="$2"; shift 2 ;;
        --export-path)    EXPORT_PATH="$2"; shift 2 ;;
        --validate-only)  VALIDATE_ONLY=1; shift ;;
        --skip-upload)    SKIP_UPLOAD=1; shift ;;
        -h|--help)        usage 0 ;;
        *)                echo "[deploy] unknown arg: $1" >&2; usage 1 ;;
    esac
done

[[ -n "$SCHEME"         ]] || { echo "[deploy] --scheme 필수" >&2; usage 1; }
[[ -n "$PROJECT"        ]] || { echo "[deploy] --project 필수" >&2; usage 1; }
[[ -n "$EXPORT_OPTIONS" ]] || { echo "[deploy] --export-options 필수 (env: EXPORT_OPTIONS)" >&2; usage 1; }

# 1) Archive
"$SCRIPT_DIR/build-archive.sh" \
    --scheme "$SCHEME" \
    --project "$PROJECT" \
    --archive-path "$ARCHIVE_PATH"

# 2) Export
IPA="$("$SCRIPT_DIR/export-ipa.sh" \
    --archive-path "$ARCHIVE_PATH" \
    --export-options "$EXPORT_OPTIONS" \
    --export-path "$EXPORT_PATH" \
    | tail -1)"

if [[ "$SKIP_UPLOAD" == "1" ]]; then
    echo "[deploy] --skip-upload — 업로드 생략. IPA: $IPA"
    exit 0
fi

[[ -n "$API_KEY"    ]] || { echo "[deploy] --api-key 필수 (env: ASC_API_KEY)" >&2; exit 1; }
[[ -n "$API_ISSUER" ]] || { echo "[deploy] --api-issuer 필수 (env: ASC_API_ISSUER)" >&2; exit 1; }

# 3) Upload
UPLOAD_ARGS=(--ipa "$IPA" --api-key "$API_KEY" --api-issuer "$API_ISSUER")
[[ "$VALIDATE_ONLY" == "1" ]] && UPLOAD_ARGS+=(--validate-only)

"$SCRIPT_DIR/upload-testflight.sh" "${UPLOAD_ARGS[@]}"

echo "[deploy] 완료"
