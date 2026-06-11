#!/usr/bin/env bash
# Snowbo Snippets macOS 打包脚本
#
# 产物:
#   src-tauri/target/{aarch64-apple-darwin|x86_64-apple-darwin|universal-apple-darwin|release}/
#     bundle/macos/Snowbo Snippets.app
#     bundle/dmg/Snowbo_Snippets_<version>_*.dmg
#
# 用法:
#   ./run-build.sh                 # 当前架构 (Apple Silicon -> arm64, Intel -> x86_64)
#   ./run-build.sh arm64           # 强制 Apple Silicon
#   ./run-build.sh x86_64          # 强制 Intel
#   ./run-build.sh universal       # Universal Binary (arm64 + x86_64,体积翻倍)
#
# 想跳过 DMG 只产 .app:     SKIP_DMG=1 ./run-build.sh
# 想只重打已有 .app 的 DMG: REPACK_DMG_ONLY=1 ./run-build.sh
# 想 Release 不签名:        CI=true ./run-build.sh   (Tauri 检测到 CI 会自动跳过 codesign)
set -euo pipefail

# ── 颜色 ──────────────────────────────────────────────────────────────────────
BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
RED=$'\033[31m'; CYAN=$'\033[36m'; RESET=$'\033[0m'
log()  { printf '%s▸%s %s\n' "$CYAN" "$RESET" "$*"; }
warn() { printf '%s⚠%s %s\n' "$YELLOW" "$RESET" "$*"; }
err()  { printf '%s✗%s %s\n' "$RED" "$RESET" "$*" >&2; }
ok()   { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$*"; }

# ── 平台校验 ──────────────────────────────────────────────────────────────────
if [[ "$(uname)" != "Darwin" ]]; then
  err "本脚本仅支持 macOS。检测到: $(uname)"
  exit 1
fi

cd "$(dirname "$0")"

# ── 选目标架构 ────────────────────────────────────────────────────────────────
ARCH_ARG="${1:-}"
HOST_ARCH="$(uname -m)"
case "$ARCH_ARG" in
  ""|host)
    case "$HOST_ARCH" in
      arm64)  TARGET="aarch64-apple-darwin" ;;
      x86_64) TARGET="x86_64-apple-darwin" ;;
      *)      err "未知主机架构: $HOST_ARCH"; exit 1 ;;
    esac
    ;;
  arm64|aarch64)        TARGET="aarch64-apple-darwin" ;;
  x86_64|x64|intel)     TARGET="x86_64-apple-darwin" ;;
  universal|fat)        TARGET="universal-apple-darwin" ;;
  *) err "未知架构参数: $ARCH_ARG (可用: arm64 / x86_64 / universal)"; exit 1 ;;
esac

log "目标三元组: ${BOLD}${TARGET}${RESET}"

# ── 工具链检查 ────────────────────────────────────────────────────────────────
need() {
  command -v "$1" >/dev/null 2>&1 || { err "缺少命令: $1 — $2"; exit 1; }
}
need node "请安装 Node.js (>= 18)"
need npm  "请安装 npm"
need cargo "请安装 Rust toolchain (https://rustup.rs)"
need rustup "请安装 rustup"
need xcrun "请安装 Xcode Command Line Tools: xcode-select --install"
need hdiutil "macOS 自带工具缺失,无法创建 DMG"
need osascript "macOS 自带工具缺失,无法写入 DMG Finder 布局"

# 确保所需 rust target 已装
ensure_target() {
  local t="$1"
  if ! rustup target list --installed | grep -q "^${t}$"; then
    log "rustup 添加 target ${t} …"
    rustup target add "$t"
  fi
}
case "$TARGET" in
  universal-apple-darwin)
    ensure_target aarch64-apple-darwin
    ensure_target x86_64-apple-darwin
    ;;
  *)
    ensure_target "$TARGET"
    ;;
esac

# ── 依赖安装 ──────────────────────────────────────────────────────────────────
if [[ ! -d node_modules ]]; then
  log "安装 npm 依赖 …"
  npm install
else
  log "node_modules 已存在,跳过 npm install (如有依赖变更请手工删除后重跑)"
fi

# Tauri CLI 走项目本地的 npm script (package.json 已声明 @tauri-apps/cli)
if [[ ! -x node_modules/.bin/tauri ]]; then
  log "缺少本地 @tauri-apps/cli,补装一次 …"
  npm install --save-dev @tauri-apps/cli
fi

# ── 清理上一次产物 (避免老 out/ 干扰 frontendDist) ────────────────────────────
if [[ "${REPACK_DMG_ONLY:-0}" != "1" ]]; then
  log "清理上一次构建产物 …"
  rm -rf out .next
  # 不删 src-tauri/target —— 增量编译可以省 80% 时间;如要全量,自行 cargo clean。
fi

create_custom_dmg() {
  local app_path="$1"
  local dmg_path="$2"
  local volume_name="Snowbo Snippets"
  local app_name
  app_name="$(basename "$app_path")"

  local dmg_dir staging rw_dmg mount_point device
  dmg_dir="$(dirname "$dmg_path")"
  staging="$(mktemp -d "${TMPDIR:-/tmp}/snowbo-dmg-staging.XXXXXX")"
  rw_dmg="$(mktemp "${TMPDIR:-/tmp}/snowbo-dmg-rw.XXXXXX").dmg"

  mkdir -p "$dmg_dir"
  cp -R "$app_path" "$staging/"
  ln -s /Applications "$staging/Applications"

  rm -f "$dmg_path" "$rw_dmg"
  hdiutil create \
    -volname "$volume_name" \
    -srcfolder "$staging" \
    -fs HFS+ \
    -format UDRW \
    -ov \
    "$rw_dmg" >/dev/null

  mount_point="$(
    hdiutil attach "$rw_dmg" -readwrite -noverify -noautoopen |
      awk -F '\t' 'index($NF, "/Volumes/") { print $NF; exit }'
  )"
  if [[ -z "$mount_point" ]]; then
    err "DMG 挂载失败,无法写入 Finder 布局"
    rm -rf "$staging" "$rw_dmg"
    return 1
  fi

  device="$(hdiutil info | awk -v mp="$mount_point" '$0 ~ mp { print $1; exit }')"

  if ! osascript <<OSA
tell application "Finder"
  tell disk "$volume_name"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {100, 100, 760, 500}
    set viewOptions to the icon view options of container window
    set arrangement of viewOptions to not arranged
    set icon size of viewOptions to 96
    set position of item "$app_name" of container window to {180, 204}
    set position of item "Applications" of container window to {480, 204}
    close
    open
    update without registering applications
    delay 1
    close
  end tell
end tell
OSA
  then
    if [[ -n "$device" ]]; then
      hdiutil detach "$device" -quiet || true
    else
      hdiutil detach "$mount_point" -quiet || true
    fi
    rm -rf "$staging" "$rw_dmg"
    return 1
  fi

  sync
  if [[ -n "$device" ]]; then
    hdiutil detach "$device" -quiet
  else
    hdiutil detach "$mount_point" -quiet
  fi

  hdiutil convert "$rw_dmg" \
    -format UDZO \
    -imagekey zlib-level=9 \
    -ov \
    -o "$dmg_path" >/dev/null

  rm -rf "$staging" "$rw_dmg"
}

# ── 构建 ──────────────────────────────────────────────────────────────────────
WANT_DMG=1
BUNDLES="app"
if [[ "${SKIP_DMG:-0}" == "1" ]]; then
  WANT_DMG=0
  warn "SKIP_DMG=1 — 仅产出 .app,不打 .dmg"
fi

if [[ "${REPACK_DMG_ONLY:-0}" == "1" ]]; then
  warn "REPACK_DMG_ONLY=1 — 跳过 Tauri 构建,复用已有 .app 重打 .dmg"
else
  log "开始 tauri build (${BOLD}${TARGET}${RESET},bundles=${BUNDLES}) …"
  echo "${DIM}—— 这一步会先 npm run build 生成 out/,再 cargo --release 编译 Rust,首次约 5-10 分钟 ——${RESET}"

  # 显式禁用 codesign:个人开发场景没有 Developer ID 证书会卡住整个 build。
  # 用户后续要发布带签名的版本,可在 tauri.conf.json 里配 macOS.signingIdentity 后去掉这两个 env。
  export APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:--}"
  export CI="${CI:-true}"

  npx tauri build --target "$TARGET" --bundles "$BUNDLES"
fi

# ── 定位产物 ──────────────────────────────────────────────────────────────────
BUNDLE_DIR="src-tauri/target/${TARGET}/release/bundle"
APP_PATH="$(find "$BUNDLE_DIR/macos" -maxdepth 1 -name '*.app' -print -quit 2>/dev/null || true)"
DMG_PATH="$(find "$BUNDLE_DIR/dmg"   -maxdepth 1 -name '*.dmg' -print -quit 2>/dev/null || true)"

if [[ "$WANT_DMG" == "1" ]]; then
  if [[ -z "$APP_PATH" ]]; then
    err "未找到 .app 产物,无法创建 DMG"
    exit 1
  fi
  DMG_PATH="$BUNDLE_DIR/dmg/Snowbo_Snippets_0.1.0_${TARGET%%-*}.dmg"
  log "创建带拖拽安装引导的 DMG …"
  create_custom_dmg "$APP_PATH" "$DMG_PATH"
fi

echo
ok "构建完成 🎉"
[[ -n "$APP_PATH" ]] && printf '   .app : %s%s%s\n' "$BOLD" "$APP_PATH" "$RESET"
[[ -n "$DMG_PATH" ]] && printf '   .dmg : %s%s%s\n' "$BOLD" "$DMG_PATH" "$RESET"

# 双击安装提示:Tauri 的 ad-hoc 构建在 macOS Gatekeeper 下首次会被拦,
# 给一行可直接复制的去隔离命令,免得用户找不到右键"打开"按钮。
if [[ -n "$APP_PATH" ]]; then
  echo
  warn "未签名的 .app 第一次打开会被 Gatekeeper 拦,可执行:"
  printf '       %sxattr -dr com.apple.quarantine %q%s\n' "$DIM" "$APP_PATH" "$RESET"
  echo "   或在 Finder 中右键 → 打开 → 仍要打开。"
fi
