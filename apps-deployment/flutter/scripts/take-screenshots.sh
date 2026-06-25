#!/usr/bin/env bash
# App Store / Play 스크린샷 일괄 캡처 — Flutter integration_test 기반.
#
# iPhone + iPad 시뮬레이터에서 locale 매트릭스를 돌며 한 번에 스크린샷을
# 모은다. 산출물은 `<project>/screenshots/<asc-locale>/<device>_<id>.png`.
#
# 환경변수 (필수):
#   SCREENSHOT_LOCALES   asc-locale:flutter-locale 쌍 (semicolon 구분)
#                        예: "en-US:en;ko:ko;ja:ja;zh-Hans:zh-CN;zh-Hant:zh-TW"
#
# 환경변수 (선택):
#   IPHONE_SIM_NAME      기본 "iPhone 17 Pro Max"
#   IPAD_SIM_NAME        기본 "iPad Pro 13-inch (M4)"
#   SCREENSHOT_TARGET    기본 "integration_test/screenshots_test.dart"
#   SCREENSHOT_DRIVER    기본 "test_driver/integration_test.dart"
#   IPAD_CROP_W,IPAD_CROP_H  iPad center-crop 크기 (기본 2048×2732 — ASC APP_IPAD_PRO_129)
#                            "" 로 두면 crop 안 함
#
# 플래그:
#   --project=<path>     실행할 Flutter 프로젝트 루트 (기본: $PWD)
#   --locale=<asc-loc>   해당 locale 만
#   --device=<iphone|ipad>  해당 디바이스 종류만
#   --skip=<asc-loc>     해당 locale 스킵
#
# 사용 예:
#   cd games/gomoku
#   source deploy.config.sh
#   $APPS_DEPLOY_DIR/flutter/scripts/take-screenshots.sh
#   $APPS_DEPLOY_DIR/flutter/scripts/take-screenshots.sh --locale=en-US
#   $APPS_DEPLOY_DIR/flutter/scripts/take-screenshots.sh --device=ipad --skip=ko

set -euo pipefail

# Homebrew 우선 (rbenv shim 이 pod 을 가로채는 문제 회피)
export PATH="/opt/homebrew/bin:$PATH"

if [[ -z "${SCREENSHOT_LOCALES:-}" ]]; then
  echo "❌ SCREENSHOT_LOCALES env 필수 (예: 'en-US:en;ko:ko;ja:ja')" >&2
  exit 2
fi

IPHONE_SIM_NAME="${IPHONE_SIM_NAME:-iPhone 17 Pro Max}"
IPAD_SIM_NAME="${IPAD_SIM_NAME:-iPad Pro 13-inch (M4)}"
SCREENSHOT_TARGET="${SCREENSHOT_TARGET:-integration_test/screenshots_test.dart}"
SCREENSHOT_DRIVER="${SCREENSHOT_DRIVER:-test_driver/integration_test.dart}"
IPAD_CROP_W="${IPAD_CROP_W:-2048}"
IPAD_CROP_H="${IPAD_CROP_H:-2732}"

project="$PWD"
ONLY_LOCALE=""
ONLY_DEVICE=""
SKIP=""
for arg in "$@"; do
  case "$arg" in
    --project=*) project="${arg#--project=}" ;;
    --locale=*)  ONLY_LOCALE="${arg#--locale=}" ;;
    --device=*)  ONLY_DEVICE="${arg#--device=}" ;;
    --skip=*)    SKIP="${arg#--skip=}" ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if [[ ! -f "$project/pubspec.yaml" ]]; then
  echo "❌ pubspec.yaml not found at $project" >&2
  exit 1
fi
cd "$project"

udid_for() {
  local name="$1"
  xcrun simctl list devices available \
    | grep -F "$name (" \
    | head -1 \
    | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/'
}

IPHONE_UDID=$(udid_for "$IPHONE_SIM_NAME")
IPAD_UDID=$(udid_for "$IPAD_SIM_NAME")

if [[ -z "$IPHONE_UDID" || -z "$IPAD_UDID" ]]; then
  echo "❌ Simulator UDID 못 찾음 (iPhone='$IPHONE_SIM_NAME'=$IPHONE_UDID, iPad='$IPAD_SIM_NAME'=$IPAD_UDID)" >&2
  exit 1
fi

# Parse SCREENSHOT_LOCALES into LOCALES array
IFS=';' read -ra LOCALES <<< "$SCREENSHOT_LOCALES"

boot() {
  local udid="$1"
  local state
  state=$(xcrun simctl list devices | awk -v u="$udid" 'index($0, u) { if ($0 ~ /Booted/) print "booted"; else print "shut"; exit }')
  if [[ "$state" != "booted" ]]; then
    echo "→ Booting $udid"
    xcrun simctl boot "$udid"
    open -ga Simulator
    sleep 6
  fi
}

capture_one() {
  local asc_loc="$1" flutter_loc="$2" device="$3" udid="$4"
  local outdir="screenshots/$asc_loc"
  mkdir -p "$outdir"

  echo ""
  echo "📸 $device · $asc_loc (flutter=$flutter_loc)"

  rm -rf .screenshots
  mkdir -p .screenshots

  flutter drive \
    --driver="$SCREENSHOT_DRIVER" \
    --target="$SCREENSHOT_TARGET" \
    -d "$udid" \
    --dart-define=SCREENSHOT_LOCALE="$flutter_loc" \
    --dart-define=SCREENSHOT_DEVICE="$device" \
    --no-pub

  shopt -s nullglob
  for f in .screenshots/${device}_*.png; do
    mv "$f" "$outdir/$(basename "$f")"
  done
  shopt -u nullglob

  # iPad: ASC APP_IPAD_PRO_129 가 정확히 IPAD_CROP_W×IPAD_CROP_H 만 받음. center-crop.
  if [[ "$device" == "ipad" && -n "$IPAD_CROP_W" && -n "$IPAD_CROP_H" ]]; then
    shopt -s nullglob
    for f in "$outdir"/ipad_*.png; do
      sips -c "$IPAD_CROP_H" "$IPAD_CROP_W" "$f" >/dev/null 2>&1 || true
    done
    shopt -u nullglob
  fi

  # ASC rejects PNGs with an alpha channel (IMAGE_ALPHA_NOT_ALLOWED).
  # Flutter's takeScreenshot saves with alpha by default, so flatten
  # everything against white before upload.
  if command -v magick >/dev/null 2>&1; then
    shopt -s nullglob
    for f in "$outdir"/${device}_*.png; do
      magick "$f" -background white -alpha remove -alpha off "$f" 2>/dev/null || true
    done
    shopt -u nullglob
  fi
}

if [[ -z "$ONLY_DEVICE" || "$ONLY_DEVICE" == "iphone" ]]; then boot "$IPHONE_UDID"; fi
if [[ -z "$ONLY_DEVICE" || "$ONLY_DEVICE" == "ipad" ]]; then boot "$IPAD_UDID"; fi

for entry in "${LOCALES[@]}"; do
  asc_loc="${entry%%:*}"
  flutter_loc="${entry##*:}"
  if [[ -n "$ONLY_LOCALE" && "$ONLY_LOCALE" != "$asc_loc" ]]; then continue; fi
  if [[ -n "$SKIP" && "$SKIP" == "$asc_loc" ]]; then
    echo "⏭  skipping $asc_loc"; continue
  fi

  if [[ -z "$ONLY_DEVICE" || "$ONLY_DEVICE" == "iphone" ]]; then
    capture_one "$asc_loc" "$flutter_loc" "iphone" "$IPHONE_UDID"
  fi
  if [[ -z "$ONLY_DEVICE" || "$ONLY_DEVICE" == "ipad" ]]; then
    capture_one "$asc_loc" "$flutter_loc" "ipad" "$IPAD_UDID"
  fi
done

echo ""
echo "✅ Done."
