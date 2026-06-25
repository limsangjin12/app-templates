#!/usr/bin/env bash
# Export macOS .pkg (또는 .app) from .xcarchive using ExportOptions.plist.
#
# Usage:
#   export-pkg.sh --archive-path PATH --export-options PATH \
#                 [--export-path build/release/export] \
#                 [--api-key KEY_ID --api-issuer ISSUER_ID]
#
# ExportOptions.plist 의 method 가:
#   - "app-store-connect" → .pkg (App Store 업로드용, App Distribution + Mac Installer Distribution 서명)
#   - "developer-id"      → 직접 배포용 .app (Developer ID 서명, notarize 필요)
#
# automatic signing + ASC API key 조합:
#   xcodebuild 가 ASC API 를 호출해 첫 서명에 필요한 cert/profile 을 자동 생성/다운.
#   --api-key/--api-issuer 가 주어지면 -authenticationKey* 플래그로 전달.
#   생략하면 Xcode 의 기존 로그인된 Apple ID 또는 keychain 의 cert/profile 사용.

set -euo pipefail

ARCHIVE_PATH=""
EXPORT_OPTIONS=""
EXPORT_PATH="build/release/export"
API_KEY="${ASC_API_KEY:-}"
API_ISSUER="${ASC_API_ISSUER:-}"

usage() {
    sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --archive-path)   ARCHIVE_PATH="$2"; shift 2 ;;
        --export-options) EXPORT_OPTIONS="$2"; shift 2 ;;
        --export-path)    EXPORT_PATH="$2"; shift 2 ;;
        --api-key)        API_KEY="$2"; shift 2 ;;
        --api-issuer)     API_ISSUER="$2"; shift 2 ;;
        -h|--help)        usage 0 ;;
        *)                echo "[export] unknown arg: $1" >&2; usage 1 ;;
    esac
done

[[ -n "$ARCHIVE_PATH"   ]] || { echo "[export] --archive-path 필수" >&2; usage 1; }
[[ -n "$EXPORT_OPTIONS" ]] || { echo "[export] --export-options 필수" >&2; usage 1; }
[[ -d "$ARCHIVE_PATH"   ]] || { echo "[export] archive 없음: $ARCHIVE_PATH" >&2; exit 1; }
[[ -f "$EXPORT_OPTIONS" ]] || { echo "[export] ExportOptions.plist 없음: $EXPORT_OPTIONS" >&2; exit 1; }

mkdir -p "$EXPORT_PATH"
LOG="$EXPORT_PATH/export.log"

ARGS=(-exportArchive
      -archivePath "$ARCHIVE_PATH"
      -exportOptionsPlist "$EXPORT_OPTIONS"
      -exportPath "$EXPORT_PATH"
      -allowProvisioningUpdates)

if [[ -n "$API_KEY" && -n "$API_ISSUER" ]]; then
    KEY_FILE="$HOME/.appstoreconnect/private_keys/AuthKey_${API_KEY}.p8"
    [[ -f "$KEY_FILE" ]] || { echo "[export] API 키 파일 없음: $KEY_FILE" >&2; exit 1; }
    ARGS+=(-authenticationKeyIssuerID "$API_ISSUER"
           -authenticationKeyID       "$API_KEY"
           -authenticationKeyPath     "$KEY_FILE")
fi

echo "[export] $ARCHIVE_PATH → $EXPORT_PATH"
if ! xcodebuild "${ARGS[@]}" >"$LOG" 2>&1; then
    echo "[export] 실패. 마지막 30줄:" >&2
    tail -30 "$LOG" >&2
    echo "[export] 전체 로그: $LOG" >&2
    exit 1
fi

# .pkg (App Store) 우선, 없으면 .app (Developer ID)
ARTIFACT="$(find "$EXPORT_PATH" -maxdepth 1 \( -name '*.pkg' -o -name '*.app' \) | head -1)"
[[ -n "$ARTIFACT" ]] || { echo "[export] .pkg / .app 못 찾음" >&2; exit 1; }

echo "[export] OK → $ARTIFACT"
echo "$ARTIFACT"   # stdout 으로 경로 — 다음 단계 파이프 가능
