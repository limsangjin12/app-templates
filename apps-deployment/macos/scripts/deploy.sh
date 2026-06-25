#!/usr/bin/env bash
# End-to-end macOS App Store 배포: archive → export → upload.
#
# Usage:
#   deploy.sh --scheme MyApp --project MyApp.xcodeproj \
#             --export-options ExportOptions.plist \
#             [--api-key KEY_ID] [--api-issuer ISSUER_ID] \
#             [--archive-path build/release/App.xcarchive] \
#             [--export-path build/release/export] \
#             [--validate-only] [--skip-upload]

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

"$SCRIPT_DIR/build-archive.sh" \
    --scheme "$SCHEME" \
    --project "$PROJECT" \
    --archive-path "$ARCHIVE_PATH"

EXPORT_ARGS=(--archive-path "$ARCHIVE_PATH"
             --export-options "$EXPORT_OPTIONS"
             --export-path    "$EXPORT_PATH")
[[ -n "$API_KEY"    ]] && EXPORT_ARGS+=(--api-key    "$API_KEY")
[[ -n "$API_ISSUER" ]] && EXPORT_ARGS+=(--api-issuer "$API_ISSUER")
ARTIFACT="$("$SCRIPT_DIR/export-pkg.sh" "${EXPORT_ARGS[@]}" | tail -1)"

if [[ "$SKIP_UPLOAD" == "1" ]]; then
    echo "[deploy] --skip-upload — 업로드 생략. artifact: $ARTIFACT"
    exit 0
fi

[[ "$ARTIFACT" == *.pkg ]] || {
    echo "[deploy] App Store 업로드는 .pkg 만 지원 (got: $ARTIFACT)" >&2
    echo "[deploy] ExportOptions.plist 의 method=app-store-connect 인지 확인" >&2
    exit 1
}

[[ -n "$API_KEY"    ]] || { echo "[deploy] --api-key 필수 (env: ASC_API_KEY)" >&2; exit 1; }
[[ -n "$API_ISSUER" ]] || { echo "[deploy] --api-issuer 필수 (env: ASC_API_ISSUER)" >&2; exit 1; }

UPLOAD_ARGS=(--pkg "$ARTIFACT" --api-key "$API_KEY" --api-issuer "$API_ISSUER")
[[ "$VALIDATE_ONLY" == "1" ]] && UPLOAD_ARGS+=(--validate-only)

"$SCRIPT_DIR/upload.sh" "${UPLOAD_ARGS[@]}"

echo "[deploy] 완료"
