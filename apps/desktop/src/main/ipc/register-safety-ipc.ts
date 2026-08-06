import { app } from 'electron';
import type Database from 'better-sqlite3';
import type { WipeScope, ImportStrategy } from '@jarvis/core';
import { createBackupIpc } from './backup';
import { createWipeIpc } from './wipe';
import { createConfigIpc } from './config';
import { WipeService } from '../wipe/WipeService';
import type { BackupService } from '../backup/BackupService';
import type { SettingsStore } from './settings';
import type { SecureStorage } from '../secrets/SecureStorage';

type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown;
type Register = (channel: string, handler: Handler) => void;

/** Backup, wipe, config import/export, and app relaunch IPC. */
export function registerSafetyIpc(
  register: Register,
  db: Database.Database,
  settings: SettingsStore,
  secrets: SecureStorage,
  getWorkspace: () => string | null,
  backup?: BackupService,
): void {
  if (backup) {
    const backupIpc = createBackupIpc(backup, backup.getBackupDir());
    register('backup.list', () => backupIpc.list());
    register('backup.create', async () => backupIpc.create());
    register('backup.restore', async (_e, file) => backupIpc.restore(_e, file as string));
  }
  register('app.relaunch', () => { app.relaunch(); app.quit(); return { ok: true }; });
  const wipeSvc = new WipeService(db, {
    deleteAllApiKeys: async () => {
      const refs: string[] = (db.prepare('SELECT api_key_ref FROM providers').all() as Array<{ api_key_ref: string }>)
        .map(r => r.api_key_ref);
      const imgRef = settings.get('image.api_key_ref') as string | undefined;
      if (imgRef) refs.push(imgRef);
      let n = 0;
      for (const ref of refs) {
        try { await secrets.delete(ref); n++; } catch { /* best-effort */ }
      }
      return n;
    },
  }, getWorkspace() ?? undefined);
  const wipeIpc = createWipeIpc(wipeSvc);
  register('wipe.run', (_e, scope, phrase) => wipeIpc.run(_e, scope as WipeScope, phrase as string));
  const config = createConfigIpc(db, settings.get);
  register('config.export', (_e, format) => config.exportConfig(format as 'json' | 'yaml'));
  register('config.import', (_e, text, strategy) => config.importConfig(text as string, strategy as ImportStrategy));
}
