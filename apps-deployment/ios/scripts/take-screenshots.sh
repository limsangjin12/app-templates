#!/usr/bin/env bash
# App Store 스크린샷 일괄 캡처 — iOS 네이티브 (xcodegen) 앱용.
#
# Flutter 짝 (`apps-deployment/flutter/scripts/take-screenshots.sh`) 의
# native-iOS 버전. 시뮬레이터 boot → xcodebuild build → simctl install →
# 각 (locale, shot) 별로 launch args 로 화면 진입 → simctl io screenshot.
#
# 산출물: `${SCREENSHOT_OUTPUT_ROOT:-<project>/screenshots}/<asc-locale>/<device>-<shot-id>.png`
#
# 환경변수 (필수):
#   SCREENSHOT_LOCALES   asc-locale:apple-locale 쌍, semicolon 구분
#                        (apple-locale = -AppleLocale 값. ko=ko_KR, en=en_US 등)
#                        예: "en-US:en_US;ko:ko_KR;ja:ja_JP;zh-Hans:zh_Hans_CN;zh-Hant:zh_Hant_TW"
#   IOS_SCHEME           iPhone/iPad 앱 scheme (예: MiniFocus)
#   IOS_BUNDLE_ID        iPhone/iPad bundle id (예: com.example.myapp)
#   IOS_APP_NAME         빌드된 .app 의 product name (예: minifocus)
#   IOS_SCREENSHOT_SHOTS newline-separated  device:shot-id:launchArgs
#                        device ∈ iphone | ipad
#                        예 (heredoc 으로):
#                          iphone:1-timer:-InitialTab timer -SkipOnboarding -AutoSeedSample
#                          iphone:2-stats:-InitialTab stats -SkipOnboarding -AutoSeedSample
#
# 환경변수 (선택):
#   WATCH_SCHEME         watchOS scheme (예: MiniFocusWatch). 없으면 watch 스킵.
#   WATCH_BUNDLE_ID      watchOS bundle id
#   WATCH_APP_NAME       watchOS .app product name
#   WATCH_SCREENSHOT_SHOTS  newline-separated  shot-id:launchArgs (device 필드 없음)
#   IPHONE_SIM_NAME      기본 "iPhone 17 Pro Max"
#   IPAD_SIM_NAME        기본 "iPad Pro 13-inch (M5)"
#   WATCH_SIM_NAME       기본 "Apple Watch Ultra 3 (49mm)"
#   LAUNCH_DELAY         기본 4 (각 shot launch 후 대기 초)
#   SCREENSHOT_OUTPUT_ROOT  기본 "$PWD/screenshots". 앱별로 명시하면 병렬 실행 시
#                            산출물이 절대 섞이지 않음.
#   SCREENSHOT_LOCK_ROOT    기본 "/tmp/apps-screenshot-locks". 같은 시뮬레이터를
#                            병렬 캡처할 때 launch → screenshot 구간을 직렬화.
#   SCREENSHOT_MASK_POLICY  기본 "ignored". Dynamic Island/notch 마스크 없이 framebuffer 저장.
#   IPHONE_HIDE_SENSOR_HOUSING  1이면 iPhone 상단 sensor housing 영역을 배경색으로 제거.
#   IPHONE_SENSOR_FILL_COLOR  기본 "#080a0d". "auto"이면 캡처 좌상단 배경색을 샘플링.
#   IPAD_CROP_W,IPAD_CROP_H  iPad center-crop 크기 (기본 2064×2752 — APP_IPAD_PRO_3GEN_129)
#                            "" 로 두면 crop 안 함
#   IPAD_ROTATE_180       1이면 iPad 캡처를 180도 회전. Simulator 화면 방향이
#                         portrait upside-down 으로 고정된 경우 앱별로 opt-in.
#
# 플래그:
#   --project=<path>     실행할 앱 디렉터리 (기본: $PWD)
#   --locale=<asc-loc>   해당 locale 만
#   --device=<iphone|ipad|watch>  해당 디바이스만
#   --skip=<asc-loc>     해당 locale 스킵
#   --no-build           시뮬레이터에 이미 install 되어 있다고 보고 launch 만
#
# 사용 예:
#   cd utilities/minifocus
#   source deploy.config.sh
#   "$APPS_DEPLOY_DIR/ios/scripts/take-screenshots.sh" --locale=ko

set -euo pipefail

if [[ -z "${SCREENSHOT_LOCALES:-}" || -z "${IOS_SCHEME:-}" || -z "${IOS_BUNDLE_ID:-}" \
   || -z "${IOS_APP_NAME:-}" || -z "${IOS_SCREENSHOT_SHOTS:-}" ]]; then
  echo "❌ SCREENSHOT_LOCALES, IOS_SCHEME, IOS_BUNDLE_ID, IOS_APP_NAME, IOS_SCREENSHOT_SHOTS env 필수" >&2
  exit 2
fi

IPHONE_SIM_NAME="${IPHONE_SIM_NAME:-iPhone 17 Pro Max}"
IPAD_SIM_NAME="${IPAD_SIM_NAME:-iPad Pro 13-inch (M5)}"
WATCH_SIM_NAME="${WATCH_SIM_NAME:-Apple Watch Ultra 3 (49mm)}"
LAUNCH_DELAY="${LAUNCH_DELAY:-4}"
IPAD_CROP_W="${IPAD_CROP_W:-2064}"
IPAD_CROP_H="${IPAD_CROP_H:-2752}"
IPAD_ROTATE_180="${IPAD_ROTATE_180:-0}"
SCREENSHOT_LOCK_ROOT="${SCREENSHOT_LOCK_ROOT:-/tmp/apps-screenshot-locks}"
SCREENSHOT_MASK_POLICY="${SCREENSHOT_MASK_POLICY:-ignored}"
IPHONE_HIDE_SENSOR_HOUSING="${IPHONE_HIDE_SENSOR_HOUSING:-0}"
IPHONE_SENSOR_FILL_COLOR="${IPHONE_SENSOR_FILL_COLOR:-#080a0d}"
IPHONE_SENSOR_FILL_HEIGHT="${IPHONE_SENSOR_FILL_HEIGHT:-172}"

project="$PWD"
ONLY_LOCALE=""
ONLY_DEVICE=""
SKIP=""
NO_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --project=*) project="${arg#--project=}" ;;
    --locale=*)  ONLY_LOCALE="${arg#--locale=}" ;;
    --device=*)  ONLY_DEVICE="${arg#--device=}" ;;
    --skip=*)    SKIP="${arg#--skip=}" ;;
    --no-build)  NO_BUILD=1 ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

cd "$project"
SCREENSHOT_OUTPUT_ROOT="${SCREENSHOT_OUTPUT_ROOT:-$PWD/screenshots}"
mkdir -p "$SCREENSHOT_OUTPUT_ROOT" "$SCREENSHOT_LOCK_ROOT"

udid_for() {
  xcrun simctl list devices available \
    | grep -F "$1 (" \
    | head -1 \
    | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/'
}

IPHONE_UDID=$(udid_for "$IPHONE_SIM_NAME")
IPAD_UDID=$(udid_for "$IPAD_SIM_NAME")
WATCH_UDID=""
if [[ -n "${WATCH_SCHEME:-}" ]]; then
  WATCH_UDID=$(udid_for "$WATCH_SIM_NAME")
fi

boot() {
  local udid="$1" name="$2"
  if [[ -z "$udid" ]]; then
    echo "❌ Simulator UDID 못 찾음: $name" >&2
    exit 1
  fi
  local state
  state=$(xcrun simctl list devices | awk -v u="$udid" 'index($0, u) { if ($0 ~ /Booted/) print "booted"; else print "shut"; exit }')
  if [[ "$state" != "booted" ]]; then
    echo "→ Booting $name ($udid)"
    xcrun simctl boot "$udid"
  fi
  # Apple HIG 의 conventional 9:41 + full signal/battery 로 status bar 고정.
  # locale 별 caputure 시 status bar 의 host 시스템 locale 누수 (예: iPad 의
  # "5월 8일 금요일" 한국어 날짜) 를 방지. watchOS 는 status_bar override 미지원.
  if [[ "$name" != *"Watch"* ]]; then
    xcrun simctl status_bar "$udid" override \
      --time "9:41" \
      --dataNetwork wifi \
      --wifiMode active \
      --wifiBars 3 \
      --cellularMode active \
      --cellularBars 4 \
      --batteryState charged \
      --batteryLevel 100 >/dev/null 2>&1 || true
  fi
}

DERIVED="build/screenshots-derived"
APP_PATH=""
WATCH_APP_PATH=""

build_app() {
  local scheme="$1" udid="$2" platform="$3" product_name="$4" var_name="$5"
  echo ""
  echo "🔨 xcodebuild scheme=$scheme  (platform=$platform)"
  # `-sdk` 명시 X — xcodegen 으로 박힌 cross-platform deps (iOS 앱 → watchOS
  # 앱) 가 강제 SDK 로 빌드되어 깨지는 걸 막기 위해. `-destination` 의
  # platform 으로 main target 에 적합한 SDK 를 자동 선택, 의존 watchOS
  # target 은 자기 자신의 SUPPORTED_PLATFORMS 에 맞춰 watchOS SDK 로 빌드됨.
  local symroot="$PWD/$DERIVED/Build/Products"
  mkdir -p "$symroot"
  xcodebuild \
    -project "${IOS_SCHEME}.xcodeproj" \
    -scheme "$scheme" \
    -configuration Debug \
    -destination "platform=$platform,id=$udid" \
    SYMROOT="$symroot" \
    -quiet \
    build
  local found
  found=$(find "$symroot" -type d -name "${product_name}.app" | head -1)
  if [[ -z "$found" ]]; then
    echo "❌ ${product_name}.app 빌드 산출물을 못 찾음 ($DERIVED)" >&2
    exit 1
  fi
  printf -v "$var_name" '%s' "$found"
}

# 빌드
if [[ "$NO_BUILD" -eq 0 ]]; then
  rm -rf "$PWD/$DERIVED"
  if [[ -z "$ONLY_DEVICE" || "$ONLY_DEVICE" == "iphone" || "$ONLY_DEVICE" == "ipad" ]]; then
    boot "$IPHONE_UDID" "$IPHONE_SIM_NAME"
    build_app "$IOS_SCHEME" "$IPHONE_UDID" "iOS Simulator" "$IOS_APP_NAME" APP_PATH
  fi
  if [[ -n "$WATCH_UDID" && ( -z "$ONLY_DEVICE" || "$ONLY_DEVICE" == "watch" ) ]]; then
    boot "$WATCH_UDID" "$WATCH_SIM_NAME"
    build_app "$WATCH_SCHEME" "$WATCH_UDID" "watchOS Simulator" "${WATCH_APP_NAME:-$WATCH_SCHEME}" WATCH_APP_PATH
  fi
fi

install_one() {
  local udid="$1" app="$2"
  if [[ -n "$app" ]]; then
    xcrun simctl install "$udid" "$app"
  fi
}

# Boot 모든 디바이스 + install
if [[ -z "$ONLY_DEVICE" || "$ONLY_DEVICE" == "iphone" ]]; then
  boot "$IPHONE_UDID" "$IPHONE_SIM_NAME"
  install_one "$IPHONE_UDID" "$APP_PATH"
fi
if [[ -z "$ONLY_DEVICE" || "$ONLY_DEVICE" == "ipad" ]]; then
  boot "$IPAD_UDID" "$IPAD_SIM_NAME"
  install_one "$IPAD_UDID" "$APP_PATH"
fi
if [[ -n "$WATCH_UDID" && ( -z "$ONLY_DEVICE" || "$ONLY_DEVICE" == "watch" ) ]]; then
  boot "$WATCH_UDID" "$WATCH_SIM_NAME"
  install_one "$WATCH_UDID" "$WATCH_APP_PATH"
fi

# Simulator UI 띄움
open -ga Simulator || true
sleep 2

# Parse SCREENSHOT_LOCALES
IFS=';' read -ra LOCALES <<< "$SCREENSHOT_LOCALES"

# Parse shot lines (skip blank)
parse_shots() {
  local raw="$1"
  printf '%s\n' "$raw" | sed '/^[[:space:]]*$/d'
}

# launch with locale + shot args
launch_shot() {
  local udid="$1" bundle="$2" apple_loc="$3" args="$4"
  xcrun simctl terminate "$udid" "$bundle" 2>/dev/null || true
  sleep 0.3
  # AppleLanguages 는 첫 두 글자만 (예: ko, en, ja, zh-Hans). asc-locale 의 -PR 부분 제거.
  local lang="${apple_loc%%_*}"
  # zh_Hans_CN / zh_Hant_TW 처리
  if [[ "$apple_loc" == zh_Hans* ]]; then lang="zh-Hans"; fi
  if [[ "$apple_loc" == zh_Hant* ]]; then lang="zh-Hant"; fi

  # shellcheck disable=SC2086
  xcrun simctl launch "$udid" "$bundle" \
    -AppleLanguages "($lang)" \
    -AppleLocale "$apple_loc" \
    $args >/dev/null
  sleep "$LAUNCH_DELAY"
}

shoot() {
  local udid="$1" outfile="$2"
  # simctl io 의 출력 경로는 절대경로여야 부모 디렉터리 해석이 안정적이다.
  if [[ "$outfile" != /* ]]; then
    outfile="$PWD/$outfile"
  fi
  mkdir -p "$(dirname "$outfile")"
  xcrun simctl io "$udid" screenshot --type=png --mask="$SCREENSHOT_MASK_POLICY" "$outfile"
  echo "  ✓ $outfile"
}

with_sim_lock() {
  local udid="$1"
  shift
  local lock="$SCREENSHOT_LOCK_ROOT/$udid.lock"
  while ! mkdir "$lock" 2>/dev/null; do
    sleep 0.2
  done
  trap 'rmdir "$lock" 2>/dev/null || true' RETURN
  "$@"
  rmdir "$lock" 2>/dev/null || true
  trap - RETURN
}

capture_ios_shot() {
  local udid="$1" device="$2" apple_loc="$3" args="$4" out="$5"
  launch_shot "$udid" "$IOS_BUNDLE_ID" "$apple_loc" "$args"
  shoot "$udid" "$out"
  if [[ "$device" == "iphone" && "$IPHONE_HIDE_SENSOR_HOUSING" == "1" ]] && command -v magick >/dev/null 2>&1; then
    local fill="$IPHONE_SENSOR_FILL_COLOR"
    if [[ "$fill" == "auto" ]]; then
      fill="#$(magick "$out" -format '%[hex:p{10,10}]' info: 2>/dev/null || printf '080a0d')"
    fi
    magick "$out" -fill "$fill" -draw "rectangle 0,0 9999,$IPHONE_SENSOR_FILL_HEIGHT" "$out" 2>/dev/null || true
  fi
  if [[ "$device" == "ipad" ]]; then
    ipad_center_crop "$out"
    if [[ "$IPAD_ROTATE_180" == "1" ]] && command -v magick >/dev/null 2>&1; then
      magick "$out" -rotate 180 "$out" 2>/dev/null || true
    fi
  fi
  flatten_alpha "$out"
}

capture_watch_shot() {
  local udid="$1" apple_loc="$2" args="$3" out="$4"
  launch_shot "$udid" "$WATCH_BUNDLE_ID" "$apple_loc" "$args"
  shoot "$udid" "$out"
  flatten_alpha "$out"
}

flatten_alpha() {
  local f="$1"
  if command -v magick >/dev/null 2>&1; then
    magick "$f" -background white -alpha remove -alpha off "$f" 2>/dev/null || true
  fi
}

ipad_center_crop() {
  local f="$1"
  if [[ -n "$IPAD_CROP_W" && -n "$IPAD_CROP_H" ]]; then
    sips -c "$IPAD_CROP_H" "$IPAD_CROP_W" "$f" >/dev/null 2>&1 || true
  fi
}

for entry in "${LOCALES[@]}"; do
  asc_loc="${entry%%:*}"
  apple_loc="${entry##*:}"
  if [[ -n "$ONLY_LOCALE" && "$ONLY_LOCALE" != "$asc_loc" ]]; then continue; fi
  if [[ -n "$SKIP" && "$SKIP" == "$asc_loc" ]]; then
    echo "⏭  skipping $asc_loc"; continue
  fi

  outdir="$SCREENSHOT_OUTPUT_ROOT/$asc_loc"
  mkdir -p "$outdir"
  echo ""
  echo "📸 locale=$asc_loc (apple=$apple_loc)"

  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    device="${line%%:*}"
    rest="${line#*:}"
    shot_id="${rest%%:*}"
    args="${rest#*:}"

    if [[ -n "$ONLY_DEVICE" && "$ONLY_DEVICE" != "$device" ]]; then continue; fi

    case "$device" in
      iphone)
        out="$outdir/${device}-${shot_id}.png"
        with_sim_lock "$IPHONE_UDID" capture_ios_shot "$IPHONE_UDID" "$device" "$apple_loc" "$args" "$out"
        ;;
      ipad)
        out="$outdir/${device}-${shot_id}.png"
        with_sim_lock "$IPAD_UDID" capture_ios_shot "$IPAD_UDID" "$device" "$apple_loc" "$args" "$out"
        ;;
      *)
        echo "  ⚠ unknown device '$device'"
        ;;
    esac
  done < <(parse_shots "$IOS_SCREENSHOT_SHOTS")

  if [[ -n "$WATCH_UDID" && ( -z "$ONLY_DEVICE" || "$ONLY_DEVICE" == "watch" ) \
        && -n "${WATCH_SCREENSHOT_SHOTS:-}" ]]; then
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      shot_id="${line%%:*}"
      args="${line#*:}"
      out="$outdir/watch-${shot_id}.png"
      with_sim_lock "$WATCH_UDID" capture_watch_shot "$WATCH_UDID" "$apple_loc" "$args" "$out"
    done < <(parse_shots "$WATCH_SCREENSHOT_SHOTS")
  fi
done

echo ""
echo "✅ Done."
