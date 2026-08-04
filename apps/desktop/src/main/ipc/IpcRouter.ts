import { ipcMain, BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { IpcChannel } from '@jarvis/protocol';
import { exportSessionMarkdown } from '@jarvis/core';
import { createSettingsStore } from './settings';
import { createProviderStore, type ProviderInput, type ModelInput } from './providers';
import { createAgentStore, type AgentInput } from './agents';
import { createMcpStore, testMcpServer, type McpServerInput } from './mcp';
import { createSkillsStore } from './skills';
import { createWorkspaceService } from './workspace';
import { registerChatHandlers } from './chat';
import { registerTaskHandlers } from './tasks';
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
    const agents = createAgentStore(this.db);
    this.register(IpcChannel.agentList, () => agents.list());
    this.register(IpcChannel.agentCreate, (_e, input) => agents.create(input as AgentInput));
    this.register(IpcChannel.agentUpdate, (_e, id, patch) => agents.update(id as string, patch as Partial<AgentInput>));
    this.register(IpcChannel.agentDelete, (_e, id) => agents.remove(id as string));
    const mcpStore = createMcpStore(this.db);
    const skillsStore = createSkillsStore(this.db);
    this.register('mcp.list', () => mcpStore.list());
    this.register('mcp.create', (_e, input) => mcpStore.create(input as McpServerInput));
    this.register('mcp.delete', (_e, id) => mcpStore.remove(id as string));
    this.register('mcp.test', (_e, input) => testMcpServer(input as McpServerInput));
    this.register('skills.list', () => skillsStore.list());
    this.register('skills.import', (_e, dir) => skillsStore.importFromDir(dir as string));
    this.register('skills.delete', (_e, id) => skillsStore.remove(id as string));
    const workspace = createWorkspaceService(this.db);
    this.register('workspace.bind', (_e, agentId, path) => { workspace.bind(agentId as string, path as string); return { ok: true }; });
    this.register('workspace.listBound', () => workspace.listBound());
    this.register('workspace.loadContext', (_e, agentId) => workspace.loadContext(agentId as string));
    this.register(IpcChannel.dialogOpenFile, async () => {
      const { dialog } = await import('electron');
      const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
      return r.canceled ? null : r.filePaths[0];
    });
    this.register(IpcChannel.providerList, () => providers.list());
    this.register(IpcChannel.providerCreate, (_e, input) => providers.create(input as ProviderInput));
    this.register(IpcChannel.providerUpdate, (_e, id, patch) => providers.update(id as string, patch as Partial<ProviderInput>));
    this.register(IpcChannel.providerDelete, (_e, id) => providers.remove(id as string));
    this.register('provider.listModels', (_e, providerId) => providers.listModels(providerId as string));
    this.register('provider.addModel', (_e, providerId, input) => providers.addModel(providerId as string, input as ModelInput));
    const chat = registerChatHandlers(this.db, secrets, () => BrowserWindow.getFocusedWindow());
    this.register(IpcChannel.chatSend, (e, args) => chat.send(e, args as { sessionId: string; text: string; agentId: string }));
    this.register('chat.listSessions', () => chat.listSessions());
    this.register('chat.createSession', (_e, title) => chat.createSession(title as string | undefined));
    this.register('chat.loadMessages', (_e, sessionId) => chat.loadMessages(sessionId as string));
    const tasks = registerTaskHandlers(this.db, secrets, () => BrowserWindow.getFocusedWindow());
    this.register(IpcChannel.taskCreate, (e, args) => tasks.create(e, args as { agentId: string; prompt: string; sessionId?: string }));
    this.register(IpcChannel.taskCancel, (_e, id) => tasks.cancel(_e, id as string));
    this.register(IpcChannel.taskPause, (_e, id) => tasks.pause(_e, id as string));
    this.register('task.resume', (_e, id) => tasks.resume(_e, id as string));
    this.register(IpcChannel.taskRetry, (_e, id) => tasks.retry(_e, id as string));
    this.register('approval.resolve', (_e, id, ok) => { tasks.approvalCenter.resolve(id as string, ok as boolean); return { ok: true }; });
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
