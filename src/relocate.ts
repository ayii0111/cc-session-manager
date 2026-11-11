import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Directories never worth descending into when looking for a moved project. */
const SKIP_DIRS = new Set(['node_modules', 'Library', 'Applications', '.git', 'dist', 'build', 'target', 'vendor']);
const MAX_DEPTH = 8;
const MAX_RESULTS = 5;
const TIME_LIMIT_MS = 5000;

function isDirectory(dir: string): boolean {
  return fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

function searchWithFd(root: string, name: string): string[] | null {
  const args = [
    '--type', 'd', '--glob', '--no-ignore', '--absolute-path', '--case-sensitive',
    '--max-depth', String(MAX_DEPTH),
    ...[...SKIP_DIRS].flatMap((d) => ['--exclude', d]),
    name, root,
  ];
  for (const bin of ['fd', 'fdfind']) {
    const r = spawnSync(bin, args, { encoding: 'utf8', timeout: TIME_LIMIT_MS });
    if (r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT') continue;
    // A timeout still leaves whatever was found so far in stdout.
    return (r.stdout ?? '').split('\n').filter(Boolean).map((p) => p.replace(/\/$/, ''));
  }
  return null;
}

/** Fallback when fd isn't installed: breadth-first walk, skipping hidden and heavy dirs. */
function searchWithWalk(root: string, name: string): string[] {
  const found: string[] = [];
  const deadline = Date.now() + TIME_LIMIT_MS;
  let level = [root];
  for (let depth = 1; depth <= MAX_DEPTH && level.length && Date.now() < deadline; depth++) {
    const next: string[] = [];
    for (const dir of level) {
      if (Date.now() >= deadline) break;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.name === name) found.push(full);
        next.push(full);
      }
    }
    level = next;
  }
  return found;
}

/** Number of leading path segments two paths share. */
function sharedPrefix(a: string, b: string): number {
  const pa = a.split(path.sep);
  const pb = b.split(path.sep);
  let i = 0;
  while (i < pa.length && i < pb.length && pa[i] === pb[i]) i++;
  return i;
}

// Files nearly every project has; matching them says nothing about which project it is.
const GENERIC_FILES = new Set([
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'tsconfig.json',
  'README.md', 'readme.md', 'CLAUDE.md', 'AGENTS.md', 'LICENSE', '.gitignore', '.env',
  'index.ts', 'index.js', 'main.ts', 'main.js', 'main.py', 'Makefile', 'Cargo.toml', 'go.mod',
]);
const IGNORED_SEGMENTS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache']);
const MAX_SAMPLES = 20;
const MIN_HITS = 3;
const MIN_RATIO = 0.6;
const FILE_PATH_RE = /"(?:file_path|notebook_path)":"((?:[^"\\]|\\.)*)"/g;

/**
 * Paths (relative to the old project dir) of files the project's sessions read or
 * wrote, most distinctive first: deeper paths and non-generic names.
 */
function collectProjectFiles(cc_project_dir: string, missingDir: string): string[] {
  const prefix = missingDir.replace(/\/$/, '') + '/';
  const counts = new Map<string, number>();
  let files: string[];
  try { files = fs.readdirSync(cc_project_dir).filter((f) => f.endsWith('.jsonl')); } catch { return []; }
  for (const f of files) {
    let text: string;
    try { text = fs.readFileSync(path.join(cc_project_dir, f), 'utf8'); } catch { continue; }
    for (const m of text.matchAll(FILE_PATH_RE)) {
      let p: string;
      try { p = JSON.parse(`"${m[1]}"`); } catch { continue; }
      if (!p.startsWith(prefix)) continue;
      const rel = p.slice(prefix.length);
      if (!rel || rel.split('/').some((s) => IGNORED_SEGMENTS.has(s))) continue;
      counts.set(rel, (counts.get(rel) ?? 0) + 1);
    }
  }
  const depth = (p: string) => p.split('/').length;
  const generic = (p: string) => GENERIC_FILES.has(path.basename(p)) && depth(p) <= 2;
  // Generic files only fill in when there aren't enough distinctive ones.
  return [...counts.keys()]
    .sort((a, b) =>
      Number(generic(a)) - Number(generic(b)) || depth(b) - depth(a) || counts.get(b)! - counts.get(a)!)
    .slice(0, MAX_SAMPLES);
}

/**
 * The existing directory a cc project-dir slug encodes, found by walking the
 * filesystem (the slug alone is lossy: `/`, `.`, `-` all become `-`). When a project
 * is moved, its cc project dir is often renamed to match the new location.
 */
function resolveSlug(slug: string): string | null {
  const encode = (name: string) => name.replace(/[^a-zA-Z0-9]/g, '-');
  const walk = (dir: string, rest: string): string | null => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const enc = encode(e.name);
      const full = path.join(dir, e.name);
      if (rest === enc) return full;
      if (rest.startsWith(enc + '-')) {
        const found = walk(full, rest.slice(enc.length + 1));
        if (found) return found;
      }
    }
    return null;
  };
  return slug.startsWith('-') ? walk('/', slug.slice(1)) : null;
}

/**
 * Directories worth checking: siblings of the old dir, the dir the cc project dir's
 * name points to, plus known project dirs and their parents.
 */
function renameCandidates(cc_project_dir: string, missingDir: string, knownProjectDirs: string[]): string[] {
  const home = os.homedir();
  const set = new Set<string>();

  const slugDir = resolveSlug(path.basename(cc_project_dir));
  if (slugDir) set.add(slugDir);

  let ancestor = path.dirname(missingDir);
  while (!isDirectory(ancestor) && ancestor !== path.dirname(ancestor)) ancestor = path.dirname(ancestor);
  try {
    for (const e of fs.readdirSync(ancestor, { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('.')) set.add(path.join(ancestor, e.name));
    }
  } catch { /* ignore */ }

  // claude may have been opened in a subdir of the renamed project, so its parents count too.
  for (const dir of knownProjectDirs) {
    let d = dir;
    for (let i = 0; i < 4 && d.startsWith(home + '/'); i++, d = path.dirname(d)) set.add(d);
  }
  set.delete(missingDir);
  return [...set];
}

/**
 * Where a project dir that no longer exists may have been renamed to: directories
 * that contain most of the files its sessions worked on, at the same relative paths.
 * Best match first.
 */
export function findRenamedDirs(cc_project_dir: string, missingDir: string, knownProjectDirs: string[]): string[] {
  const samples = collectProjectFiles(cc_project_dir, missingDir);
  if (samples.length < MIN_HITS) return [];
  const minHits = Math.max(MIN_HITS, Math.ceil(samples.length * MIN_RATIO));
  return renameCandidates(cc_project_dir, missingDir, knownProjectDirs)
    .map((dir) => ({ dir, hits: samples.filter((rel) => fs.existsSync(path.join(dir, rel))).length }))
    .filter((c) => c.hits >= minHits)
    .sort((a, b) => b.hits - a.hits || a.dir.length - b.dir.length)
    .slice(0, MAX_RESULTS)
    .map((c) => c.dir);
}

/**
 * Directories under the home dir with the same name as a project dir that no longer
 * exists — likely where it was moved to. Closest to the old location first.
 */
export function findSameNameDirs(missingDir: string): string[] {
  const name = path.basename(missingDir);
  const home = os.homedir();
  if (!name) return [];
  const results = searchWithFd(home, name) ?? searchWithWalk(home, name);
  return [...new Set(results)]
    .filter((p) => p !== missingDir && isDirectory(p))
    .sort((a, b) => sharedPrefix(b, missingDir) - sharedPrefix(a, missingDir) || a.length - b.length)
    .slice(0, MAX_RESULTS);
}
