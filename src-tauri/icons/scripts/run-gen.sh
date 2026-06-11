#!/usr/bin/env bash
# 从 icon.png 生成 Tauri 所需的全套图标
#
# 用法:
#   ./run-gen.sh
set -euo pipefail

BOLD=$'\033[1m'; GREEN=$'\033[32m'; RED=$'\033[31m'; CYAN=$'\033[36m'; RESET=$'\033[0m'
log() { printf '%s▸%s %s\n' "$CYAN" "$RESET" "$*"; }
err() { printf '%s✗%s %s\n' "$RED" "$RESET" "$*" >&2; }
ok()  { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$*"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ICONS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GEN_SCRIPT="${SCRIPT_DIR}/generate.py"
SOURCE="${SCRIPT_DIR}/icon.png"
ICONSET="${ICONS_DIR}/icon.iconset"
ICNS="${ICONS_DIR}/icon.icns"

if [[ ! -f "$SOURCE" ]]; then
  err "缺少源图: $SOURCE"
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  err "缺少 python3,请先安装 Python 3"
  exit 1
fi

if ! python3 -c "import PIL" 2>/dev/null; then
  log "安装 Pillow …"
  python3 -m pip install --user Pillow
fi

log "运行 ${BOLD}generate.py${RESET} …"
python3 "$GEN_SCRIPT"

if [[ "$(uname)" == "Darwin" ]]; then
  if ! command -v iconutil >/dev/null 2>&1; then
    err "缺少 iconutil,请安装 Xcode Command Line Tools: xcode-select --install"
    exit 1
  fi
  log "打包 ${BOLD}icon.icns${RESET} …"
  tmp_icns="$(mktemp "${TMPDIR:-/tmp}/icon.XXXXXX.icns")"
  iconutil --convert icns --output "$tmp_icns" "$ICONSET"
  mv "$tmp_icns" "$ICNS"
else
  log "非 macOS,跳过 icon.icns (需在 macOS 上运行 iconutil)"
fi

ok "图标已更新 → ${ICONS_DIR}"
