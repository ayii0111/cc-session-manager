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

/**
 * Find a cwd that belongs to this project dir, i.e. encodes to its slug (CC turns
 * every non-alphanumeric path character into `-`). A session's cwd can change
 * midway and its file can move between project dirs, while `claude -r` only finds
 * a session when launched from the directory matching the file's project dir.
 */
function findProjectCwd(lines: any[], cc_project_dir: string): string | undefined {
  const slug = path.basename(cc_project_dir);
  return lines.find(l => typeof l.cwd === 'string' && l.cwd.replace(/[^a-zA-Z0-9]/g, '-') === slug)?.cwd;
}

/** Prefer the latest custom title (user rename), then the latest aiTitle. */
function findTitle(reversedLines: any[]): string | undefined {
  return (
    reversedLines.find(l => l.type === 'custom-title' && l.customTitle)?.customTitle ??
    reversedLines.find(l => l.type === 'ai-title' && l.aiTitle)?.aiTitle
  );
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

      const matchedCwd = findProjectCwd(reversedLines, cc_project_dir);
      const realCwd: string | undefined = matchedCwd ?? reversedLines.find(l => l.cwd)?.cwd;
      const cwd_matched = !!matchedCwd;
      const cwd_inferred = !realCwd;
      const original_project_dir = realCwd ?? slugToPath(path.basename(cc_project_dir));

      const session_name = sanitizeName(findTitle(reversedLines) ?? '(untitled)');

      const lastTimeLine = reversedLines.find(l => l.timestamp);
      const lastTime: string = lastTimeLine?.timestamp ?? stat.mtime.toISOString();

      return { cc_project_dir, original_project_dir, cwd_inferred, cwd_matched, session_name, session_id, lastTime, fileSize };
    }

    // Large files: targeted head + tail reads
    // customTitle: last occurrence → check tail; if not there, check head
    const tailContent = await readTail(filePath, 16384);
    const tailLines = parseJsonLines(tailContent);
    const reversedTail = [...tailLines].reverse();

    // Look for a cwd belonging to this project, widening the search since recent
    // CC versions write very large lines. Otherwise keep the latest cwd seen.
    // Last resort: reverse-engineer from the slug so the session still shows.
    let matchedCwd = findProjectCwd(reversedTail, cc_project_dir);
    let latestCwd: string | undefined = reversedTail.find(l => l.cwd)?.cwd;
    const widerReads = [
      () => readTail(filePath, 65536),
      () => readTail(filePath, 262144),
      () => readHead(filePath, 2048),
      () => readHead(filePath, 8192),
      () => readHead(filePath, 32768),
    ];
    for (const read of widerReads) {
      if (matchedCwd) break;
      const lines = parseJsonLines(await read()).reverse();
      matchedCwd = findProjectCwd(lines, cc_project_dir);
      latestCwd ??= lines.find(l => l.cwd)?.cwd;
    }
    const realCwd = matchedCwd ?? latestCwd;
    const cwd_matched = !!matchedCwd;
    const cwd_inferred = !realCwd;
    const original_project_dir = realCwd ?? slugToPath(path.basename(cc_project_dir));

    // CC re-appends title entries throughout the session, so the tail usually has
    // one; widen the tail window progressively since recent CC versions write
    // very large lines (prompt snapshots, request shapes) between them.
    let title = findTitle(reversedTail);
    for (const chunkSize of [65536, 262144]) {
      if (title || chunkSize >= fileSize) break;
      title = findTitle(parseJsonLines(await readTail(filePath, chunkSize)).reverse());
    }
    // Last resort: the first aiTitle may sit far past the head of the file
    // behind those same large lines.
    for (const chunkSize of [16384, 262144]) {
      if (title) break;
      const aiTitleEntry = parseJsonLines(await readHead(filePath, chunkSize))
        .find(l => l.type === 'ai-title' && l.aiTitle);
      title = aiTitleEntry?.aiTitle;
    }
    const session_name = sanitizeName(title ?? '(untitled)');

    const lastTimeLine = reversedTail.find(l => l.timestamp);
    const lastTime: string = lastTimeLine?.timestamp ?? stat.mtime.toISOString();

    return { cc_project_dir, original_project_dir, cwd_inferred, cwd_matched, session_name, session_id, lastTime, fileSize };
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

      // Sessions are newest-first. Prefer a cwd matching this project dir, then any
      // real cwd; only fall back to the slug if no session has one.
      const realCwdSession = sessions.find(s => !s.cwd_inferred);
      const sourceSession = sessions.find(s => s.cwd_matched) ?? realCwdSession ?? sessions[0];
      const original_project_dir = sourceSession.original_project_dir;
      for (const s of sessions) {
        if (s.cwd_inferred || (sourceSession.cwd_matched && !s.cwd_matched)) {
          s.original_project_dir = original_project_dir;
        }
      }

      results.push({
        project: {
          cc_project_dir,
          original_project_dir,
          path_inferred: !realCwdSession,
        },
        sessions,
        latestSessionTime: sessions[0].lastTime,
      });
    })
  );

  results.sort((a, b) => b.latestSessionTime.localeCompare(a.latestSessionTime));

  return results.map(({ project, sessions }) => ({ project, sessions }));
}
