import { ipcMain } from 'electron';
import type Database from 'better-sqlite3';
import { IpcChannel } from '@jarvis/protocol';
import { createSettingsStore } from './settings';
import { collectEnvInfo } from '../diagnostics/env';
import { DaemonSupervisor } from '../daemon/DaemonSupervisor';

type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown;

export class IpcRouter {
  private handlers = new Map<string, Handler>();
  constructor(private db: Database.Database) {}

  register(channel: string, handler: Handler): void {
    this.handlers.set(channel, handler);
  }

  registerAll(daemon: DaemonSupervisor): void {
    const settings = createSettingsStore(this.db);
    this.register(IpcChannel.settingsGet, (_e, key) => settings.get(key as string));
    this.register(IpcChannel.settingsSet, (_e, key, value) => { settings.set(key as string, value); });
    this.register(IpcChannel.daemonStatus, () => daemon.status());
    this.register(IpcChannel.daemonRestart, () => { daemon.restart(); return { ok: true }; });
    const collectEnv = () => collectEnvInfo({ daemonRunning: async () => (await daemon.status()).running });
    this.register(IpcChannel.envInfo, collectEnv);
    this.register(IpcChannel.diagnosticsRun, collectEnv);
  }

  listen(): void {
    for (const [channel, handler] of this.handlers) {
      ipcMain.handle(channel, handler);
    }
  }
}
