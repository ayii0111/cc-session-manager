import { spawn } from 'child_process';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

const CWD_FILE = '/tmp/ccs-cwd';

function writeCwd(dir: string): void {
  try { fs.writeFileSync(CWD_FILE, dir); } catch { /* ignore */ }
}

function spawnAndHint(args: string[], cwd: string): void {
  writeCwd(cwd);
  const child = spawn('claude', args, { cwd, stdio: 'inherit' });
  child.on('error', (err) => {
    console.error('Failed to start claude:', err.message);
  });
  child.on('close', () => {
    process.stdout.write(`\n\x1b[2m💡 cd ${cwd}\x1b[0m\n`);
  });
}

export function newSession(original_project_dir: string): void {
  spawnAndHint([], original_project_dir);
}

export function resumeSession(session_id: string, original_project_dir: string): void {
  spawnAndHint(['-r', session_id], original_project_dir);
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

export async function deleteDirectory(cc_project_dir: string): Promise<void> {
  await fsp.rm(cc_project_dir, { recursive: true, force: true });
}
