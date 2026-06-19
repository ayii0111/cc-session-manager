#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const SHARE_DIR = path.join(HOME, '.local', 'share', 'ccs');
const BIN_DIR = path.join(HOME, '.local', 'bin');
const BIN_PATH = path.join(BIN_DIR, 'ccs');
const DIST_SRC = path.join(__dirname, '..', 'dist', 'index.js');
const DIST_DEST = path.join(SHARE_DIR, 'ccs.js');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

if (!fs.existsSync(DIST_SRC)) {
  console.error('✗ dist/index.js 不存在，請先執行 pnpm build');
  process.exit(1);
}

ensureDir(SHARE_DIR);
ensureDir(BIN_DIR);

fs.copyFileSync(DIST_SRC, DIST_DEST);
fs.chmodSync(DIST_DEST, 0o755);

try { fs.unlinkSync(BIN_PATH); } catch {}
fs.symlinkSync(DIST_DEST, BIN_PATH);

console.log(`✓ deployed → ${DIST_DEST}`);
