#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');
const os = require('os');

const HOME = os.homedir();
const SHARE_DIR = path.join(HOME, '.local', 'share', 'ccs');
const BIN_DIR = path.join(HOME, '.local', 'bin');
const BIN_PATH = path.join(BIN_DIR, 'ccs');
const DIST_SRC = path.join(__dirname, '..', 'dist', 'index.js');
const DIST_DEST = path.join(SHARE_DIR, 'ccs.js');
const ZSHRC = path.join(HOME, '.zshrc');
const MARKER = '# ccs shell integration';

const WRAPPER = `
${MARKER}
ccs() {
  rm -f /tmp/ccs-cwd
  command ccs "$@"
  local __d
  __d=$(cat /tmp/ccs-cwd 2>/dev/null)
  [ -n "$__d" ] && cd "$__d"
  rm -f /tmp/ccs-cwd
}
`;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function deployBinary() {
  ensureDir(SHARE_DIR);
  ensureDir(BIN_DIR);

  fs.copyFileSync(DIST_SRC, DIST_DEST);
  fs.chmodSync(DIST_DEST, 0o755);

  // Remove existing symlink or file
  try { fs.unlinkSync(BIN_PATH); } catch {}
  fs.symlinkSync(DIST_DEST, BIN_PATH);

  console.log(`✓ 已安裝到 ${DIST_DEST}`);
  console.log(`✓ 已建立指令 ${BIN_PATH}`);
}

function hasWrapper() {
  if (!fs.existsSync(ZSHRC)) return false;
  return fs.readFileSync(ZSHRC, 'utf8').includes(MARKER);
}

function addWrapper() {
  fs.appendFileSync(ZSHRC, WRAPPER);
  console.log(`✓ 已寫入 ${ZSHRC}`);
  console.log('  請執行 source ~/.zshrc 或重開 terminal 讓設定生效');
}

async function askWrapper() {
  if (hasWrapper()) {
    console.log('✓ ~/.zshrc 已有 shell 整合，跳過');
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('? 是否自動加入 shell 整合到 ~/.zshrc？(讓退出 Claude 後自動 cd) [Y/n] ', (ans) => {
      rl.close();
      if (ans.toLowerCase() !== 'n') {
        addWrapper();
      } else {
        console.log('  跳過 shell 整合（之後可再執行 pnpm setup）');
      }
      resolve();
    });
  });
}

async function main() {
  console.log('🔧 CCS Setup\n');

  if (!fs.existsSync(DIST_SRC)) {
    console.error('✗ dist/index.js 不存在，請先執行 pnpm build');
    process.exit(1);
  }

  deployBinary();
  await askWrapper();

  const pathDirs = (process.env.PATH || '').split(path.delimiter);
  if (!pathDirs.includes(BIN_DIR)) {
    console.log(`\n⚠️  ${BIN_DIR} 不在 PATH 中，ccs 指令可能無法直接使用。`);
    console.log(`   請將以下加入 ~/.zshrc：export PATH="${BIN_DIR}:$PATH"`);
  }

  console.log('\n✅ 完成！現在可以用 ccs 指令啟動工具。');
}

main().catch((err) => { console.error(err); process.exit(1); });
