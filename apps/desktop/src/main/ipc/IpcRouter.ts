import { ipcMain, BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { IpcChannel } from '@jarvis/protocol';
import { exportSessionMarkdown, substituteTemplate, type ShortcutBindings } from '@jarvis/core';
import { createSettingsStore } from './settings';
import { createProviderStore, type ProviderInput, type ModelInput } from './providers';
import { createAgentStore } from './agents';
import { createBusPersist, createSquadEventPush, getMessageBus, registerSquadIpc } from './squad';
import { globalSearch } from './search';
import { registerChatHandlers } from './chat';
import { registerRuntimeHandlers } from './runtime';
import { registerTaskHandlers } from './tasks';
import { createTaskboardIpc } from './taskboard';
import { createUsageIpc } from './usage';
import { createShortcutsIpc } from './shortcuts';
import { createAuditIpc } from './audit';
import { createArtifactsIpc } from './artifacts';
import { registerAgentsIpc } from './register-agents-ipc';
import { registerCodingIpc } from './register-coding-ipc';
import { registerSafetyIpc } from './register-safety-ipc';
import { BackupService } from '../backup/BackupService';
import { UsageTracker } from '../usage/UsageTracker';
import { registerOfficeIpc, createOfficeChatStream } from './office';
import { testProviderConnectivity, runDiagnostics } from './diagnostics';
import { collectEnvInfo } from '../diagnostics/env';
import { DaemonSupervisor } from '../daemon/DaemonSupervisor';
import { createSecureStorage } from '../secrets/createSecureStorage';
import { createTemplatesStore } from './templates';

type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown;

export class IpcRouter {
  private handlers = new Map<string, Handler>();
  private disposeFns: Array<() => void> = [];
  constructor(private db: Database.Database) {}

  register(channel: string, handler: Handler): void {
    this.handlers.set(channel, handler);
  }

  registerAll(daemon: DaemonSupervisor, backup?: BackupService): void {
    const settings = createSettingsStore(this.db);
    const shortcuts = createShortcutsIpc(k => settings.get(k), (k, v) => settings.set(k, v));
    this.register('shortcuts.get', () => shortcuts.get());
    this.register('shortcuts.set', (_e, bindings) => shortcuts.set(_e, bindings as ShortcutBindings));
    const secrets = createSecureStorage();
    const providers = createProviderStore(this.db, secrets);
    const { agents, getWorkspace } = registerAgentsIpc((ch, h) => this.register(ch, h), this.db);
    registerCodingIpc((ch, h) => this.register(ch, h), this.db, agents, getWorkspace);
    const usageTracker = new UsageTracker(this.db);
    const chat = registerChatHandlers(this.db, secrets, () => BrowserWindow.getFocusedWindow(), { usageTracker });
    this.register(IpcChannel.chatSend, (e, args) => chat.send(e, args as Parameters<typeof chat.send>[1]));
    this.register(IpcChannel.chatListSessions, () => chat.listSessions());
    this.register(IpcChannel.chatCreateSession, (_e, title) => chat.createSession(title as string | undefined));
    this.register(IpcChannel.chatLoadMessages, (_e, sessionId) => chat.loadMessages(sessionId as string));
    const tasks = registerTaskHandlers(this.db, secrets, () => BrowserWindow.getFocusedWindow(), createAgentStore(this.db), { settings, usageTracker });
    this.register(IpcChannel.taskCreate, (e, args) => tasks.create(e, args as { agentId: string; prompt: string; sessionId?: string }));
    this.register(IpcChannel.taskCancel, (_e, id) => tasks.cancel(_e, id as string));
    this.register(IpcChannel.taskPause, (_e, id) => tasks.pause(_e, id as string));
    this.register(IpcChannel.taskResume, (_e, id) => tasks.resume(_e, id as string));
    this.register(IpcChannel.taskRetry, (_e, id) => tasks.retry(_e, id as string));
    this.register(IpcChannel.taskRollback, (_e, id) => tasks.rollback(_e, id as string));
    this.register(IpcChannel.approvalResolve, (_e, id, ok) => { tasks.approvalCenter.resolve(id as string, ok as boolean); return { ok: true }; });
    const taskboard = createTaskboardIpc(this.db);
    this.register(IpcChannel.taskboardList, () => taskboard.list());
    const usage = createUsageIpc(usageTracker);
    this.register('usage.summary', () => usage.summary());
    this.register('usage.list', (_e, agentId) => usage.list(agentId as string | undefined));
    const audit = createAuditIpc(this.db);
    this.register('audit.list', (_e, filter) => audit.list(filter as { kind?: string; result?: string }));
    this.register('audit.export', (_e, filter) => audit.exportAudit(filter as { kind?: string; result?: string; format?: 'csv' | 'jsonl' }));
    const artifacts = createArtifactsIpc(this.db);
    this.register('artifacts.list', (_e, taskId) => artifacts.list(_e, taskId as string));
    this.register('artifacts.save', (_e, a) => artifacts.save(_e, a as Parameters<typeof artifacts.save>[1]));
    registerSafetyIpc((ch, h) => this.register(ch, h), this.db, settings, secrets, getWorkspace, backup);
    registerSquadIpc((ch, h) => this.register(ch, h), { db: this.db, getWindow: () => BrowserWindow.getFocusedWindow(), runner: tasks.squad });
    this.register(IpcChannel.settingsGet, (_e, key) => settings.get(key as string));
    this.register(IpcChannel.settingsSet, (_e, key, value) => { settings.set(key as string, value); });
    this.register('proxy.get', () => settings.getAll().proxy_json ?? { mode: 'none' });
    this.register('proxy.set', (_e, cfg: unknown) => { settings.set('proxy_json', cfg); return { ok: true }; });
    this.register(IpcChannel.secretsSet, async (_e, key, value) => { await secrets.set(key as string, value as string); return { ok: true }; });
    this.register(IpcChannel.secretsGet, async (_e, key) => secrets.get(key as string));
    this.register(IpcChannel.secretsDelete, async (_e, key) => { await secrets.delete(key as string); return { ok: true }; });
    this.register(IpcChannel.daemonStatus, () => daemon.status());
    this.register(IpcChannel.daemonRestart, () => { daemon.restart(); return { ok: true }; });
    registerRuntimeHandlers(
      (ch, h) => this.register(ch, h),
      () => daemon.getRuntimeStatus(),
      () => daemon.getRuntimeConflicts(),
      { get: (k) => settings.get(k), set: (k, v) => settings.set(k, v) },
    );
    const collectEnv = () => collectEnvInfo({ daemonRunning: async () => (await daemon.status()).running });
    this.register(IpcChannel.envInfo, collectEnv);
    this.register(IpcChannel.diagnosticsRun, () => runDiagnostics(this.db, secrets));
    this.register('provider.test', (_e, providerId, modelId) => testProviderConnectivity(this.db, secrets, providerId as string, modelId as string));
    this.register(IpcChannel.providerList, () => providers.list());
    this.register(IpcChannel.providerCreate, (_e, input) => providers.create(input as ProviderInput));
    this.register(IpcChannel.providerUpdate, (_e, id, patch) => providers.update(id as string, patch as Partial<ProviderInput>));
    this.register(IpcChannel.providerDelete, (_e, id) => providers.remove(id as string));
    this.register('provider.listModels', (_e, providerId) => providers.listModels(providerId as string));
    this.register('provider.addModel', (_e, providerId, input) => providers.addModel(providerId as string, input as ModelInput));
    this.register('export.session', async (_e, sessionId) => {
      const rows = this.db.prepare('SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at').all(sessionId as string) as Array<{ role: string; content: string }>;
      return exportSessionMarkdown(rows);
    });
    registerOfficeIpc({ register: (ch, h) => this.register(ch, h) }, createOfficeChatStream(this.db, secrets), { settings, secrets });
    const templates = createTemplatesStore(this.db);
    this.register('templates.list', () => templates.list());
    this.register('templates.create', (_e, input) => templates.create(input as { name: string; content: string }));
    this.register('templates.update', (_e, id, input) => {
      try {
        templates.update(id as string, input as { name?: string; content?: string });
        return { ok: true as const };
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
      }
    });
    this.register('templates.delete', (_e, id) => { templates.remove(id as string); return { ok: true }; });
    this.register('templates.render', (_e, req) => {
      const { id, vars } = req as { id: string; vars?: Record<string, string> };
      const tpl = templates.list().find(t => t.id === id);
      if (!tpl) return { ok: false as const, error: `template ${id} not found` };
      return { ok: true as const, result: substituteTemplate(tpl.content, vars ?? {}) };
    });
    this.register('search.global', (_e, args) => {
      try {
        const { query } = (args ?? {}) as { query?: string };
        return { ok: true as const, results: globalSearch(this.db, query ?? '') };
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
      }
    });
    this.disposeFns.push(createBusPersist(this.db, getMessageBus()));
    this.disposeFns.push(createSquadEventPush(getMessageBus(), () => BrowserWindow.getFocusedWindow()));
  }

  listen(): void {
    for (const [channel, handler] of this.handlers) {
      ipcMain.handle(channel, handler);
    }
  }

  dispose(): void {
    for (const fn of this.disposeFns) fn();
    this.disposeFns = [];
  }
}
