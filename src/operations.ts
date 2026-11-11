import { spawn } from 'child_process';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline';
import { findRenamedDirs, findSameNameDirs } from './relocate';

const CWD_FILE = '/tmp/sm-cwd';

function writeCwd(dir: string): void {
  try { fs.writeFileSync(CWD_FILE, dir); } catch { /* ignore */ }
}

function isDirectory(dir: string): boolean {
  return fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

function startClaude(args: string[], cwd?: string, onClose?: () => void): void {
  const child = spawn('claude', args, { cwd, stdio: 'inherit' });
  child.on('error', (err) => {
    console.error('Failed to start claude:', err.message);
  });
  if (onClose) child.on('close', onClose);
}

function spawnAndHint(args: string[], cwd: string): void {
  writeCwd(cwd);
  startClaude(args, cwd, () => {
    process.stdout.write(`\n\x1b[2m💡 cd ${cwd}\x1b[0m\n`);
  });
}

export function newSession(original_project_dir: string): void {
  // Node reports a missing cwd as `spawn claude ENOENT`, which reads like claude isn't installed.
  if (!isDirectory(original_project_dir)) {
    console.error(`無法啟動 claude，目錄已不存在：${original_project_dir}`);
    return;
  }
  spawnAndHint([], original_project_dir);
}

/** 不啟動 claude，只讓 shell wrapper 在 sm 結束後 cd 到專案目錄 */
export function changeDirectory(original_project_dir: string): void {
  if (!isDirectory(original_project_dir)) {
    console.error(`無法切換，目錄已不存在：${original_project_dir}`);
    return;
  }
  writeCwd(original_project_dir);
}

export function resumeSession(
  session_id: string,
  original_project_dir: string,
  cc_project_dir: string,
  knownProjectDirs: string[],
): void {
  if (isDirectory(original_project_dir)) {
    spawnAndHint(['-r', session_id], original_project_dir);
    return;
  }

  process.stdout.write(
    `\x1b[33m! 舊的專案目錄已不存在：${original_project_dir}\n` +
    `  請儘快將此 session 搬移到正確的目錄：在 claude 內執行 /cd <正確路徑>\x1b[0m\n` +
    `\x1b[2m  搜尋專案的新位置中…\x1b[0m`,
  );
  const listPaths = (paths: string[]) => paths.map((p) => `    \x1b[36m${p}\x1b[0m\n`).join('');
  const oneOf = (paths: string[]) => (paths.length > 1 ? '以下其中之一' : '');
  const moved = findSameNameDirs(original_project_dir);
  const renamed = moved.length ? [] : findRenamedDirs(cc_project_dir, original_project_dir, knownProjectDirs);
  process.stdout.write('\r\x1b[K');
  if (moved.length) {
    process.stdout.write(`  找到同名目錄，專案可能已搬移到${oneOf(moved)}：\n${listPaths(moved)}`);
  } else if (renamed.length) {
    process.stdout.write(
      `  找不到同名目錄，但依此專案 session 用過的檔案比對，專案可能已重新命名為${oneOf(renamed)}：\n` +
      listPaths(renamed),
    );
  } else {
    process.stdout.write(`\x1b[2m  找不到同名目錄，也找不到檔案結構相符的目錄\x1b[0m\n`);
  }
  process.stdout.write('\n');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('SIGINT', () => rl.close());
  rl.question('按 Enter 繼續進入此 session，Ctrl+C 取消：', () => {
    rl.close();
    // `claude -r <id>` finds the session from any directory, so stay in the current one.
    startClaude(['-r', session_id]);
  });
}

export async function renameSession(cc_project_dir: string, session_id: string, new_name: string): Promise<void> {
  const filePath = path.join(cc_project_dir, `${session_id}.jsonl`);
  const record = JSON.stringify({ type: 'custom-title', customTitle: new_name, sessionId: session_id });
  await fsp.appendFile(filePath, record + '\n');
}

export async function deleteSession(cc_project_dir: string, session_id: string): Promise<void> {
  await fsp.rm(path.join(cc_project_dir, `${session_id}.jsonl`), { force: true });
  try {
    await fsp.rm(path.join(cc_project_dir, session_id), { recursive: true, force: true });
  } catch {
  }
}

export async function deleteAllSessions(cc_project_dir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fsp.readdir(cc_project_dir);
  } catch {
    return;
  }
  const jsonlFiles = entries.filter((e) => e.endsWith('.jsonl'));
  await Promise.all(
    jsonlFiles.map((e) => {
      const session_id = e.slice(0, -6);
      return deleteSession(cc_project_dir, session_id);
    }),
  );
}

/** 只刪除專案的 memory 目錄，回傳是否原本有 memory */
export async function deleteMemory(cc_project_dir: string): Promise<boolean> {
  const memoryDir = path.join(cc_project_dir, 'memory');
  if (!isDirectory(memoryDir)) return false;
  await fsp.rm(memoryDir, { recursive: true, force: true });
  return true;
}

export async function deleteDirectory(cc_project_dir: string): Promise<void> {
  await fsp.rm(cc_project_dir, { recursive: true, force: true });
}
