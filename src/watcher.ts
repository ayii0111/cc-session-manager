import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const CC_SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions');

/**
 * Verify a process is alive via signal 0 (no actual signal sent).
 * ESRCH = process gone (stale PID file after a crash). EPERM = alive but
 * owned by another user, which still counts as active.
 */
function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === 'EPERM';
  }
}

export class ActiveSessionWatcher {
  private activeSet: Set<string> = new Set();
  private watcher: fs.FSWatcher | null = null;
  private fallbackTimer: NodeJS.Timeout | null = null;
  private onUpdate: (activeSet: Set<string>) => void;

  constructor(onUpdate: (activeSet: Set<string>) => void) {
    this.onUpdate = onUpdate;
  }

  async start(): Promise<void> {
    await this._scan();

    try {
      this.watcher = fs.watch(CC_SESSIONS_DIR, async () => {
        await this._scan();
        this.onUpdate(this.activeSet);
      });
      this.watcher.on('error', () => {});
    } catch {
    }

    this.fallbackTimer = setInterval(async () => {
      await this._scan();
      this.onUpdate(this.activeSet);
    }, 3000);
  }

  private async _scan(): Promise<void> {
    const newSet = new Set<string>();
    try {
      const entries = await fsp.readdir(CC_SESSIONS_DIR);
      await Promise.all(
        entries
          .filter((e) => e.endsWith('.json'))
          .map(async (e) => {
            try {
              const raw = await fsp.readFile(path.join(CC_SESSIONS_DIR, e), 'utf-8');
              const data = JSON.parse(raw);
              // PID from the field, falling back to the filename ([pid].json).
              const pid = typeof data.pid === 'number' ? data.pid : parseInt(e, 10);
              if (data.sessionId && isPidAlive(pid)) {
                newSet.add(data.sessionId);
              }
            } catch {
            }
          }),
      );
    } catch {
    }
    this.activeSet = newSet;
  }

  getActive(): Set<string> {
    return this.activeSet;
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }
}

export async function isSessionActive(sessionId: string): Promise<boolean> {
  try {
    const entries = await fsp.readdir(CC_SESSIONS_DIR);
    const results = await Promise.all(
      entries
        .filter((e) => e.endsWith('.json'))
        .map(async (e) => {
          try {
            const raw = await fsp.readFile(path.join(CC_SESSIONS_DIR, e), 'utf-8');
            const data = JSON.parse(raw);
            const pid = typeof data.pid === 'number' ? data.pid : parseInt(e, 10);
            return data.sessionId === sessionId && isPidAlive(pid);
          } catch {
            return false;
          }
        }),
    );
    return results.some(Boolean);
  } catch {
    return false;
  }
}
