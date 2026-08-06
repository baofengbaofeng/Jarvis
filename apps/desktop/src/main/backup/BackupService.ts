import { mkdirSync, statSync, readdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';

export interface BackupInfo { file: string; name: string; sizeBytes: number; createdAt: string }

// L18 (M8 Task 4): SQLite auto-backup and restore. Backups are timestamped
// snapshots taken with better-sqlite3's online backup API (WAL-consistent), so
// they can be created while the app is live. restore() closes the db handle
// (the app is expected to relaunch immediately after) and copies the chosen
// backup file back over the main db path.
export class BackupService {
  private timer: NodeJS.Timeout | null = null;
  // L18 review fix: restore() closes the db handle; once closed this service is
  // dead (the app is expected to relaunch immediately). Track it so no caller —
  // e.g. the will-quit best-effort backup — can hit the closed connection.
  private closed = false;

  constructor(private db: Database, private dir: string, private mainPath?: string) {
    mkdirSync(dir, { recursive: true });
  }

  getBackupDir(): string { return this.dir; }

  start(intervalMs = 24 * 60 * 60 * 1000): void {
    this.stop();
    this.timer = setInterval(() => { void this.createBackup(); }, intervalMs);
    this.timer.unref();
  }
  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async createBackup(): Promise<string> {
    if (this.closed) return ''; // no-op after restore: the db handle is closed
    const stamp = new Date().toISOString().replace(/[-:.T]/g, '').slice(0, 14);
    const file = join(this.dir, `${stamp}.db`);
    await this.db.backup(file); // better-sqlite3 online backup (WAL-consistent snapshot)
    return file;
  }

  list(): BackupInfo[] {
    return readdirSync(this.dir)
      .filter(f => f.endsWith('.db'))
      .map(f => {
        const p = join(this.dir, f);
        const st = statSync(p);
        return { file: p, name: f, sizeBytes: st.size, createdAt: st.birthtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async restore(file: string): Promise<void> {
    if (!this.mainPath) throw new Error('mainPath required for restore');
    this.db.pragma('wal_checkpoint(TRUNCATE)');
    this.db.close();
    this.closed = true;
    this.stop(); // the interval timer must not keep firing on the closed handle
    copyFileSync(file, this.mainPath);
  }
}
