import { ipcMain, BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { IpcChannel } from '@jarvis/protocol';
import { exportSessionMarkdown } from '@jarvis/core';
import { createSettingsStore } from './settings';
import { createProviderStore, type ProviderInput } from './providers';
import { registerChatHandlers } from './chat';
import { testProviderConnectivity, runDiagnostics } from './diagnostics';
import { collectEnvInfo } from '../diagnostics/env';
import { DaemonSupervisor } from '../daemon/DaemonSupervisor';
import { SecureStorage } from '../secrets/SecureStorage';

type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown;

export class IpcRouter {
  private handlers = new Map<string, Handler>();
  constructor(private db: Database.Database) {}

  register(channel: string, handler: Handler): void {
    this.handlers.set(channel, handler);
  }

  registerAll(daemon: DaemonSupervisor): void {
    const settings = createSettingsStore(this.db);
    const secrets = new SecureStorage();
    const providers = createProviderStore(this.db, secrets);
    this.register(IpcChannel.providerList, () => providers.list());
    this.register(IpcChannel.providerCreate, (_e, input) => providers.create(input as ProviderInput));
    this.register(IpcChannel.providerUpdate, (_e, id, patch) => providers.update(id as string, patch as Partial<ProviderInput>));
    this.register(IpcChannel.providerDelete, (_e, id) => providers.remove(id as string));
    const chat = registerChatHandlers(this.db, secrets, () => BrowserWindow.getFocusedWindow());
    this.register(IpcChannel.chatSend, (e, args) => chat.send(e, args as { sessionId: string; text: string; agentId: string }));
    this.register('chat.listSessions', () => chat.listSessions());
    this.register('chat.createSession', (_e, title) => chat.createSession(title as string | undefined));
    this.register('chat.loadMessages', (_e, sessionId) => chat.loadMessages(sessionId as string));
    this.register(IpcChannel.settingsGet, (_e, key) => settings.get(key as string));
    this.register(IpcChannel.settingsSet, (_e, key, value) => { settings.set(key as string, value); });
    this.register('proxy.get', () => settings.getAll().proxy_json ?? { mode: 'none' });
    this.register('proxy.set', (_e, cfg: unknown) => { settings.set('proxy_json', cfg); return { ok: true }; });
    this.register(IpcChannel.secretsSet, async (_e, key, value) => { await secrets.set(key as string, value as string); return { ok: true }; });
    this.register(IpcChannel.secretsGet, async (_e, key) => secrets.get(key as string));
    this.register(IpcChannel.secretsDelete, async (_e, key) => { await secrets.delete(key as string); return { ok: true }; });
    this.register(IpcChannel.daemonStatus, () => daemon.status());
    this.register(IpcChannel.daemonRestart, () => { daemon.restart(); return { ok: true }; });
    const collectEnv = () => collectEnvInfo({ daemonRunning: async () => (await daemon.status()).running });
    this.register(IpcChannel.envInfo, collectEnv);
    this.register(IpcChannel.diagnosticsRun, () => runDiagnostics(this.db, secrets));
    this.register('provider.test', (_e, providerId, modelId) => testProviderConnectivity(this.db, secrets, providerId as string, modelId as string));
    this.register('export.session', async (_e, sessionId) => {
      const rows = this.db.prepare('SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at').all(sessionId as string) as Array<{ role: string; content: string }>;
      return exportSessionMarkdown(rows);
    });
  }

  listen(): void {
    for (const [channel, handler] of this.handlers) {
      ipcMain.handle(channel, handler);
    }
  }
}
