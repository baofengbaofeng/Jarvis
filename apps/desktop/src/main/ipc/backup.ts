import { resolve, relative, isAbsolute } from 'node:path';
import type { BackupService } from '../backup/BackupService';

// L18 (M8 Task 4): backup/list/create/restore IPC. restore closes the service's
// db handle, so it signals `restart: true` and the renderer relaunches the app.
export function createBackupIpc(svc: BackupService, backupDir: string) {
  return {
    list: () => svc.list(),
    create: async () => ({ file: await svc.createBackup() }),
    restore: async (_e: unknown, file: string) => {
      const resolved = resolve(file);
      const root = resolve(backupDir);
      const rel = relative(root, resolved);
      if (rel.startsWith('..') || isAbsolute(rel)) {
        return { ok: false as const, error: 'backup path must be under backup directory' };
      }
      if (!resolved.endsWith('.db')) {
        return { ok: false as const, error: 'invalid backup file' };
      }
      await svc.restore(resolved);
      return { ok: true as const, restart: true };
    },
  };
}
