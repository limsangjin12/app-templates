#!/usr/bin/env bash
# Upload .pkg to App Store Connect (TestFlight 자동 매칭).
#
# Usage:
#   upload.sh --pkg PATH --api-key KEY_ID --api-issuer ISSUER_ID
#             [--validate-only]
#
# .p8 키 파일은 ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8 위치에
# 있어야 한다. App Store 배포 (`-t macos`) 만 처리. Developer ID 직배포는
# 별도 스크립트 (notarize.sh, 미작성).

set -euo pipefail

PKG=""
API_KEY="${ASC_API_KEY:-}"
API_ISSUER="${ASC_API_ISSUER:-}"
VALIDATE_ONLY=0

usage() {
    sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --pkg)           PKG="$2"; shift 2 ;;
        --api-key)       API_KEY="$2"; shift 2 ;;
        --api-issuer)    API_ISSUER="$2"; shift 2 ;;
        --validate-only) VALIDATE_ONLY=1; shift ;;
        -h|--help)       usage 0 ;;
        *)               echo "[upload] unknown arg: $1" >&2; usage 1 ;;
    esac
done

[[ -n "$PKG" && -n "$API_KEY" && -n "$API_ISSUER" ]] || {
    echo "[upload] --pkg / --api-key / --api-issuer 모두 필요 (env 가능: ASC_API_KEY, ASC_API_ISSUER)" >&2
    usage 1
}
[[ -f "$PKG" ]] || { echo "[upload] PKG 없음: $PKG" >&2; exit 1; }

KEY_FILE="$HOME/.appstoreconnect/private_keys/AuthKey_${API_KEY}.p8"
[[ -f "$KEY_FILE" ]] || {
    echo "[upload] API 키 파일 없음: $KEY_FILE" >&2
    exit 1
}

echo "[upload] validate $PKG"
xcrun altool --validate-app -f "$PKG" -t macos \
    --apiKey "$API_KEY" --apiIssuer "$API_ISSUER"

if [[ "$VALIDATE_ONLY" == "1" ]]; then
    echo "[upload] validate-only — 종료"
    exit 0
fi

echo "[upload] upload-app $PKG"
xcrun altool --upload-app -f "$PKG" -t macos \
    --apiKey "$API_KEY" --apiIssuer "$API_ISSUER"

echo "[upload] OK — App Store Connect 처리까지 ~10–30분"
