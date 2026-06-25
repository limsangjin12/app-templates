#!/usr/bin/env bash
# Flutter ARB 파일 키 sync 검증.
#
# 환경변수:
#   ARB_DIR     ARB 디렉터리 (기본: lib/l10n)
#   ARB_PREFIX  파일 prefix (기본: app_, 즉 app_en.arb / app_ko.arb / ...)
#   ARB_REF     기준 locale (기본: en)
#   ARB_LOCALES 검사 locale 콤마 구분 (기본: ARB_DIR 의 모든 app_*.arb 자동 감지)
#
# 사용법:
#   cd <flutter project root>
#   /path/to/apps-deployment/flutter/scripts/check-arb.sh

set -euo pipefail

ARB_DIR="${ARB_DIR:-lib/l10n}"
ARB_PREFIX="${ARB_PREFIX:-app_}"
ARB_REF="${ARB_REF:-en}"

if [ ! -d "$ARB_DIR" ]; then
  echo "❌ $ARB_DIR not found (run from Flutter project root, or set ARB_DIR)" >&2
  exit 1
fi

if [ -n "${ARB_LOCALES:-}" ]; then
  IFS=',' read -ra LOCALES <<< "$ARB_LOCALES"
else
  LOCALES=()
  while IFS= read -r f; do
    base="$(basename "$f" .arb)"
    LOCALES+=("${base#$ARB_PREFIX}")
  done < <(ls "$ARB_DIR/${ARB_PREFIX}"*.arb 2>/dev/null | sort)
fi

if [ ${#LOCALES[@]} -lt 2 ]; then
  echo "❌ Need at least 2 ARB files in $ARB_DIR matching ${ARB_PREFIX}*.arb" >&2
  exit 1
fi

keys_of() {
  python3 - "$1" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
print("\n".join(sorted(k for k in data if not k.startswith("@"))))
PY
}

ref_file="$ARB_DIR/${ARB_PREFIX}${ARB_REF}.arb"
if [ ! -f "$ref_file" ]; then
  echo "❌ Reference $ref_file not found" >&2
  exit 1
fi
ref_keys=$(keys_of "$ref_file")
status=0

for locale in "${LOCALES[@]}"; do
  [ "$locale" = "$ARB_REF" ] && continue
  f="$ARB_DIR/${ARB_PREFIX}${locale}.arb"
  [ ! -f "$f" ] && { echo "❌ $f missing" >&2; status=1; continue; }
  loc_keys=$(keys_of "$f")
  missing=$(comm -23 <(echo "$ref_keys") <(echo "$loc_keys"))
  extra=$(comm -13 <(echo "$ref_keys") <(echo "$loc_keys"))
  if [ -n "$missing" ] || [ -n "$extra" ]; then
    echo "==> $locale"
    [ -n "$missing" ] && echo "   missing (in $ARB_REF, not in $locale):" && echo "$missing" | sed 's/^/     - /'
    [ -n "$extra" ]   && echo "   extra (in $locale, not in $ARB_REF):"   && echo "$extra"   | sed 's/^/     + /'
    status=1
  fi
done

[ $status -eq 0 ] && echo "✅ All ARB files have matching keys (${LOCALES[*]})."
exit $status
