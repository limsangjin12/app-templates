#!/usr/bin/env bash
# Upload an .ipa to App Store Connect (TestFlight 자동 매칭).
#
# Usage:
#   upload-testflight.sh --ipa PATH --api-key KEY_ID --api-issuer ISSUER_ID
#                        [--validate-only]
#
# .p8 키 파일은 ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8 위치에
# 있어야 한다 (altool 이 자동 탐색).

set -euo pipefail

IPA=""
API_KEY="${ASC_API_KEY:-}"
API_ISSUER="${ASC_API_ISSUER:-}"
VALIDATE_ONLY=0

usage() {
    sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --ipa)            IPA="$2"; shift 2 ;;
        --api-key)        API_KEY="$2"; shift 2 ;;
        --api-issuer)     API_ISSUER="$2"; shift 2 ;;
        --validate-only)  VALIDATE_ONLY=1; shift ;;
        -h|--help)        usage 0 ;;
        *)                echo "[upload] unknown arg: $1" >&2; usage 1 ;;
    esac
done

if [[ -z "$IPA" || -z "$API_KEY" || -z "$API_ISSUER" ]]; then
    echo "[upload] --ipa / --api-key / --api-issuer 모두 필요 (env 가능: ASC_API_KEY, ASC_API_ISSUER)" >&2
    usage 1
fi
[[ -f "$IPA" ]] || { echo "[upload] IPA 없음: $IPA" >&2; exit 1; }

KEY_FILE="$HOME/.appstoreconnect/private_keys/AuthKey_${API_KEY}.p8"
[[ -f "$KEY_FILE" ]] || {
    echo "[upload] API 키 파일 없음: $KEY_FILE" >&2
    echo "[upload] App Store Connect 에서 .p8 다운로드 후 위 경로에 저장" >&2
    exit 1
}

# 1) 검증.
echo "[upload] validate $IPA"
xcrun altool --validate-app \
    -f "$IPA" \
    -t ios \
    --apiKey "$API_KEY" \
    --apiIssuer "$API_ISSUER"

if [[ "$VALIDATE_ONLY" == "1" ]]; then
    echo "[upload] validate-only — 종료"
    exit 0
fi

# 2) 업로드.
echo "[upload] upload-app $IPA"
xcrun altool --upload-app \
    -f "$IPA" \
    -t ios \
    --apiKey "$API_KEY" \
    --apiIssuer "$API_ISSUER"

echo "[upload] OK — App Store Connect 처리까지 ~10–30분"
