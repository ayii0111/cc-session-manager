#!/bin/sh
# sm 一鍵安裝
#   從 repo 內執行（sh install.sh）：以當前原始碼打包後安裝
#   透過 curl | sh 執行：下載 GitHub Release 的打包檔後安裝
# 環境變數 SM_DOWNLOAD_URL：指定打包檔網址，並強制走下載模式
set -eu

DEFAULT_URL='https://github.com/ayii0111/cc-session-manager/releases/latest/download/sm.js'
SHARE_DIR="$HOME/.local/share/sm"
DIST_DEST="$SHARE_DIR/sm.js"
BIN_DIR="$HOME/.local/bin"
BIN_PATH="$BIN_DIR/sm"
BLOCK_START='# >>> sm shell integration >>>'
BLOCK_END='# <<< sm shell integration <<<'

fail() {
  echo "✗ $1" >&2
  exit 1
}

check_node() {
  command -v node >/dev/null 2>&1 || fail '找不到 node，請先安裝 Node.js 18 以上版本'
  node -e 'process.exit(parseInt(process.versions.node) >= 18 ? 0 : 1)' \
    || fail "Node.js 版本過舊（$(node -v)），需要 18 以上"
}

check_bin_path() {
  if [ -e "$BIN_PATH" ] || [ -L "$BIN_PATH" ]; then
    [ "$(readlink "$BIN_PATH" 2>/dev/null || true)" = "$DIST_DEST" ] \
      || fail "$BIN_PATH 已存在且不屬於本工具，為避免覆蓋已中止"
  fi
}

# Prints the repo root when running from a local checkout; prints nothing otherwise.
find_repo_dir() {
  [ -z "${SM_DOWNLOAD_URL:-}" ] || return 0
  [ -f "$0" ] || return 0
  repo_dir=$(cd "$(dirname "$0")" && pwd)
  if [ -f "$repo_dir/package.json" ] && [ -f "$repo_dir/src/index.ts" ]; then
    echo "$repo_dir"
  fi
}

build_from_source() {
  command -v pnpm >/dev/null 2>&1 || fail '從原始碼安裝需要 pnpm'
  [ -d "$1/node_modules" ] || pnpm --dir "$1" install --frozen-lockfile
  pnpm --dir "$1" run build
  cp "$1/dist/index.js" "$2"
}

download_release() {
  command -v curl >/dev/null 2>&1 || fail '下載需要 curl'
  curl -fsSL "${SM_DOWNLOAD_URL:-$DEFAULT_URL}" -o "$1" || fail '下載打包檔失敗'
  [ -s "$1" ] || fail '下載到的打包檔是空的'
}

find_shell_rc() {
  case "$(basename "${SHELL:-}")" in
    zsh) echo "${ZDOTDIR:-$HOME}/.zshrc" ;;
    bash) echo "$HOME/.bashrc" ;;
  esac
}

write_shell_block() {
  # Keep trailing state intact so uninstall + install leaves the file byte-identical.
  if [ -s "$1" ] && [ -n "$(tail -c 1 "$1")" ]; then
    printf '\n' >> "$1"
  fi
  {
    echo "$BLOCK_START"
    cat <<'EOF'
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac
function sm() {
  command rm -f /tmp/sm-cwd
  command sm "$@"
  local target_dir="$(command cat /tmp/sm-cwd 2>/dev/null)"
  [ -n "$target_dir" ] && cd "$target_dir"
  command rm -f /tmp/sm-cwd
}
EOF
    echo "$BLOCK_END"
  } >> "$1"
}

install_shell_block() {
  shell_rc=$(find_shell_rc)
  if [ -z "$shell_rc" ]; then
    echo '! 目前的 shell 不是 zsh 或 bash，未設定自動 cd；sm 其他功能不受影響'
    echo "  請確認 $BIN_DIR 已在 PATH 中"
    return 0
  fi
  if [ -f "$shell_rc" ] && grep -qxF "$BLOCK_START" "$shell_rc"; then
    echo "✓ shell 整合已存在：$shell_rc"
    return 0
  fi
  write_shell_block "$shell_rc"
  echo "✓ 已寫入 shell 整合：$shell_rc"
}

main() {
  check_node
  check_bin_path
  repo_dir=$(find_repo_dir)

  mkdir -p "$SHARE_DIR" "$BIN_DIR"
  tmp_file="$DIST_DEST.tmp.$$"
  trap 'rm -f "$tmp_file"' EXIT

  if [ -n "$repo_dir" ]; then
    echo '→ 從原始碼打包'
    build_from_source "$repo_dir" "$tmp_file"
  else
    echo '→ 下載打包檔'
    download_release "$tmp_file"
  fi

  chmod 755 "$tmp_file"
  mv "$tmp_file" "$DIST_DEST"
  ln -sf "$DIST_DEST" "$BIN_PATH"
  echo "✓ 已安裝指令：$BIN_PATH"

  install_shell_block

  command -v claude >/dev/null 2>&1 || echo '! 找不到 claude 指令，接續或新開會話需要 Claude Code'
  echo '✅ 完成！開新終端機後執行 sm 即可使用'
}

# Everything runs from here, so a truncated `curl | sh` download can't half-execute.
main "$@"
