#!/bin/sh
# sm 一鍵移除：移除指令、安裝檔與 shell 整合
# 不會動到 ~/.claude 內的任何 session 資料
set -eu

SHARE_DIR="$HOME/.local/share/sm"
DIST_DEST="$SHARE_DIR/sm.js"
BIN_PATH="$HOME/.local/bin/sm"
BLOCK_START='# >>> sm shell integration >>>'
BLOCK_END='# <<< sm shell integration <<<'

remove_bin() {
  if [ -L "$BIN_PATH" ] && [ "$(readlink "$BIN_PATH")" = "$DIST_DEST" ]; then
    rm -f "$BIN_PATH"
    echo "✓ 已移除指令：$BIN_PATH"
  elif [ -e "$BIN_PATH" ] || [ -L "$BIN_PATH" ]; then
    echo "! $BIN_PATH 不屬於本工具，已保留"
  fi
}

remove_files() {
  if [ -d "$SHARE_DIR" ]; then
    rm -f "$DIST_DEST"
    rmdir "$SHARE_DIR" 2>/dev/null || echo "! $SHARE_DIR 內還有其他檔案，已保留"
    echo "✓ 已移除安裝檔：$DIST_DEST"
  fi
  rm -f /tmp/sm-cwd
}

# Must match install.sh: $ZDOTDIR may be a terminal's temporary integration dir.
find_zsh_rc() {
  zsh_dir=$(env -u ZDOTDIR zsh -c 'printf %s "${ZDOTDIR:-$HOME}"' </dev/null 2>/dev/null | tail -n 1 || true)
  echo "${zsh_dir:-$HOME}/.zshrc"
}

remove_shell_block() {
  [ -f "$1" ] || return 0
  grep -qxF "$BLOCK_START" "$1" || return 0
  if ! grep -qxF "$BLOCK_END" "$1"; then
    echo "! $1 的 shell 整合區塊缺少結尾標記，請手動移除"
    return 0
  fi
  tmp_file=$(mktemp)
  awk -v start="$BLOCK_START" -v end="$BLOCK_END" '
    $0 == start { skip = 1; next }
    $0 == end { skip = 0; next }
    !skip
  ' "$1" > "$tmp_file"
  # Overwrite in place to keep the file's permissions and any symlink.
  cat "$tmp_file" > "$1"
  rm -f "$tmp_file"
  echo "✓ 已移除 shell 整合：$1"
}

main() {
  remove_bin
  remove_files
  remove_shell_block "$(find_zsh_rc)"
  remove_shell_block "$HOME/.bashrc"
  echo '✅ 已移除 sm；已開啟的終端機需重開，才會清掉載入中的 sm 函式'
}

main "$@"
