#!/usr/bin/env bash
# 1024×1024 placeholder app icon 생성기. ImageMagick 7 필요.
#
# Apple 요구사항 충족:
# - 8-bit RGB (no alpha)
# - 1024×1024 정확
# - 모서리 / 가장자리에 투명도 X (full bleed)
#
# 디자인: radial gradient + 흰색 timer ring + 1/3 진행률 arc.
# (실제 디자인이 들어오기 전 ASC validation 통과용 임시.)
#
# Usage (env-driven):
#   ICON_TINT='#FF453A' \
#   ICON_BRIGHT='#FF7B6A' \
#   ICON_DARK='#D43022' \
#   ICON_OUT='/path/to/icon-1024.png[:/another/path/icon-1024.png:...]' \
#   apps-deployment/ios/scripts/render-placeholder-icon.sh
#
# Required env:
#   ICON_OUT       콜론(:) 구분 출력 경로 목록. 1 개 이상.
#
# Optional env (default = focus red):
#   ICON_TINT      대표 색 — alpha-remove 시 background (#RRGGBB)
#   ICON_BRIGHT    radial gradient 의 밝은 쪽 (기본: ICON_TINT)
#   ICON_DARK      radial gradient 의 어두운 쪽 (기본: ICON_TINT)

set -euo pipefail

if [[ -z "${ICON_OUT:-}" ]]; then
    cat <<USAGE >&2
[render-placeholder-icon] ICON_OUT env 필요. 예:
  ICON_TINT='#FF453A' ICON_BRIGHT='#FF7B6A' ICON_DARK='#D43022' \\
    ICON_OUT='/path/to/icon.png' \\
    apps-deployment/ios/scripts/render-placeholder-icon.sh

여러 출력 경로는 콜론(:) 으로 구분.
USAGE
    exit 2
fi

if ! command -v magick >/dev/null 2>&1; then
    echo "[render-placeholder-icon] ImageMagick 7 (magick) 필요. 'brew install imagemagick'" >&2
    exit 1
fi

TINT="${ICON_TINT:-#FF453A}"
BRIGHT="${ICON_BRIGHT:-$TINT}"
DARK="${ICON_DARK:-$TINT}"

TMP="$(mktemp -d)"
trap "rm -rf $TMP" EXIT

magick -size 1024x1024 \
    "radial-gradient:${BRIGHT}-${DARK}" \
    "$TMP/base.png"

magick "$TMP/base.png" \
    -fill none -stroke 'rgba(255,255,255,0.30)' -strokewidth 36 \
    -draw "circle 512,512 512,180" \
    "$TMP/with-track.png"

# 12 시 → 4 시 시계 방향 (약 1/3) progress arc.
magick "$TMP/with-track.png" \
    -fill none -stroke white -strokewidth 36 \
    -draw "path 'M 512,180 A 332,332 0 0 1 799,678 '" \
    "$TMP/with-arc.png"

magick "$TMP/with-arc.png" \
    -fill 'rgba(255,255,255,0.85)' \
    -draw "circle 512,512 512,460" \
    "$TMP/with-pivot.png"

# Apple 요구사항: alpha 제거 + 8-bit RGB.
magick "$TMP/with-pivot.png" \
    -background "$TINT" -alpha remove -alpha off \
    -depth 8 -colorspace sRGB \
    -define png:color-type=2 \
    "$TMP/final.png"

IFS=':' read -ra OUTS <<< "$ICON_OUT"
for out in "${OUTS[@]}"; do
    mkdir -p "$(dirname "$out")"
    cp "$TMP/final.png" "$out"
    echo "[render-placeholder-icon] wrote $out"
done
