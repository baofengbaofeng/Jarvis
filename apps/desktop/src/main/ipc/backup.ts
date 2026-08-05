import type { BackupService } from '../backup/BackupService';

// L18 (M8 Task 4): backup/list/create/restore IPC. restore closes the service's
// db handle, so it signals `restart: true` and the renderer relaunches the app.
export function createBackupIpc(svc: BackupService) {
  return {
    list: () => svc.list(),
    create: async () => ({ file: await svc.createBackup() }),
    restore: async (_e: unknown, file: string) => {
      await svc.restore(file);
      return { ok: true, restart: true };
    },
  };
}
