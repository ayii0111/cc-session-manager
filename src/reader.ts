import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { ProjectInfo, SessionInfo } from './types';

const CC_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

async function readHead(filePath: string, bytes: number): Promise<string> {
  const fh = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    const content = buf.subarray(0, bytesRead).toString('utf8');
    const lastNewline = content.lastIndexOf('\n');
    return lastNewline === -1 ? content : content.slice(0, lastNewline);
  } finally {
    await fh.close();
  }
}

async function readTail(filePath: string, bytes: number): Promise<string> {
  const stat = await fs.stat(filePath);
  const fileSize = stat.size;
  const offset = Math.max(0, fileSize - bytes);
  const readBytes = fileSize - offset;

  const fh = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(readBytes);
    const { bytesRead } = await fh.read(buf, 0, readBytes, offset);
    const content = buf.subarray(0, bytesRead).toString('utf8');
    if (offset === 0) return content;
    const firstNewline = content.indexOf('\n');
    return firstNewline === -1 ? '' : content.slice(firstNewline + 1);
  } finally {
    await fh.close();
  }
}

/**
 * Lossy reverse of CC's project-dir slug (path with `/` replaced by `-`).
 * Used only as a last resort so a session never silently disappears; dashes
 * in real directory names can't be distinguished from separators.
 */
function slugToPath(slug: string): string {
  return '/' + slug.replace(/^-/, '').replace(/-/g, '/');
}

/**
 * Strip ANSI escape sequences and control characters from a session name so a
 * crafted/odd title can't corrupt the TUI layout. Keeps printable text only.
 */
function sanitizeName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/[\x00-\x1f\x7f]/g, '');
  return cleaned.trim() || '(untitled)';
}

function parseJsonLines(content: string): any[] {
  return content
    .split('\n')
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(x => x !== null);
}

export async function parseSessionFile(
  filePath: string,
  cc_project_dir: string
): Promise<SessionInfo | null> {
  try {
    const stat = await fs.stat(filePath);
    const session_id = path.basename(filePath, '.jsonl');
    const fileSize = stat.size;

    // Small files: read once, parse everything
    if (fileSize <= 65536) {
      const content = await fs.readFile(filePath, 'utf8');
      const allLines = parseJsonLines(content);
      const reversedLines = [...allLines].reverse();

      const cwdLine = allLines.find(l => l.cwd);
      const original_project_dir: string =
        cwdLine?.cwd ?? slugToPath(path.basename(cc_project_dir));

      const customTitleEntry = reversedLines.find(l => l.type === 'custom-title' && l.customTitle);
      const aiTitleEntry = allLines.find(l => l.type === 'ai-title' && l.aiTitle);
      const session_name: string = sanitizeName(customTitleEntry?.customTitle ?? aiTitleEntry?.aiTitle ?? '(untitled)');

      const lastTimeLine = reversedLines.find(l => l.timestamp);
      const lastTime: string = lastTimeLine?.timestamp ?? stat.mtime.toISOString();

      return { cc_project_dir, original_project_dir, session_name, session_id, lastTime, fileSize };
    }

    // Large files: targeted head + tail reads
    let original_project_dir = '';
    for (const chunkSize of [2048, 8192, 32768]) {
      if (original_project_dir) break;
      const headContent = await readHead(filePath, chunkSize);
      for (const line of parseJsonLines(headContent)) {
        if (line.type === 'user' && line.cwd) {
          original_project_dir = line.cwd;
          break;
        }
      }
    }

    // customTitle: last occurrence → check tail; if not there, check head
    const tailContent = await readTail(filePath, 16384);
    const tailLines = parseJsonLines(tailContent);
    const reversedTail = [...tailLines].reverse();

    // Fallback for a huge first message (> 32KB): any tail line carries cwd too.
    // Last resort: reverse-engineer from the slug so the session still shows.
    if (!original_project_dir) {
      original_project_dir =
        reversedTail.find(l => l.cwd)?.cwd ?? slugToPath(path.basename(cc_project_dir));
    }

    const customTitleInTail = reversedTail.find(l => l.type === 'custom-title' && l.customTitle);

    let session_name: string;
    if (customTitleInTail) {
      session_name = sanitizeName(customTitleInTail.customTitle);
    } else {
      // aiTitle is auto-generated near the beginning
      const headForTitle = await readHead(filePath, 16384);
      const aiTitleEntry = parseJsonLines(headForTitle).find(l => l.type === 'ai-title' && l.aiTitle);
      session_name = sanitizeName(aiTitleEntry?.aiTitle ?? '(untitled)');
    }

    const lastTimeLine = reversedTail.find(l => l.timestamp);
    const lastTime: string = lastTimeLine?.timestamp ?? stat.mtime.toISOString();

    return { cc_project_dir, original_project_dir, session_name, session_id, lastTime, fileSize };
  } catch {
    return null;
  }
}

export async function getSessions(cc_project_dir: string): Promise<SessionInfo[]> {
  const entries = await fs.readdir(cc_project_dir, { withFileTypes: true });
  const jsonlFiles = entries.filter(e => e.isFile() && e.name.endsWith('.jsonl'));

  const sessions = await Promise.all(
    jsonlFiles.map(e => parseSessionFile(path.join(cc_project_dir, e.name), cc_project_dir))
  );

  return sessions
    .filter((s): s is SessionInfo => s !== null)
    .sort((a, b) => b.lastTime.localeCompare(a.lastTime));
}

export interface ProjectWithSessions {
  project: ProjectInfo;
  sessions: SessionInfo[];
}

export async function getProjectsWithSessions(): Promise<ProjectWithSessions[]> {
  const entries = await fs.readdir(CC_PROJECTS_DIR, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));

  const results: Array<ProjectWithSessions & { latestSessionTime: string }> = [];

  await Promise.all(
    dirs.map(async e => {
      const cc_project_dir = path.join(CC_PROJECTS_DIR, e.name);
      const sessions = await getSessions(cc_project_dir);
      if (sessions.length === 0) return;
      results.push({
        project: {
          cc_project_dir,
          original_project_dir: sessions[0].original_project_dir,
        },
        sessions,
        latestSessionTime: sessions[0].lastTime,
      });
    })
  );

  results.sort((a, b) => b.latestSessionTime.localeCompare(a.latestSessionTime));

  return results.map(({ project, sessions }) => ({ project, sessions }));
}
