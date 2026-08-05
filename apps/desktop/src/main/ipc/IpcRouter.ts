import { ipcMain, BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { IpcChannel } from '@jarvis/protocol';
import { exportSessionMarkdown, IndexStore, hashEmbedding, type TreeNode } from '@jarvis/core';
import { createCodeIndexAdapter, reindexWorkspace, applyDiffToFile, readDiffFile, createSnapshotStore } from './coding';
import { searchMentions } from './mention';
import { createSettingsStore } from './settings';
import { createProviderStore, type ProviderInput, type ModelInput } from './providers';
import { createAgentStore, type AgentInput } from './agents';
import { createMcpStore, testMcpServer, type McpServerInput } from './mcp';
import { createSkillsStore } from './skills';
import { createWorkspaceIpc, createWorkspaceService } from './workspace';
import { registerChatHandlers } from './chat';
import { registerTaskHandlers } from './tasks';
import { registerOfficeIpc, createOfficeChatStream } from './office';
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
    // Pass the agents store so skills.import can copy SKILL.md into every bound
    // workspace's .jarvis/skills/ (the runtime injection surface), J2 fix.
    const skillsStore = createSkillsStore(this.db, agents);
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
    // M4 Task 7 (E11/K3): code-panel tree/read IPC. Single-active assumption: the
    // code panel targets ONE workspace — the first agent that has one bound. This
    // mirrors the renderer agent-store, where `current` falls back to agents[0].
    const getWorkspace = (): string | null => agents.list().find(a => a.workspaceId)?.workspaceId ?? null;
    const workspaceIpc = createWorkspaceIpc(getWorkspace);
    this.register('workspace.tree', () => workspaceIpc.tree());
    this.register('workspace.read', (_e, rel) => workspaceIpc.read(rel as string));
    // M5 Task 7 (L22): dropped non-attach files are copied into the active
    // workspace (see createWorkspaceIpc.copyFiles).
    this.register('workspace.copyFiles', (_e, paths) => workspaceIpc.copyFiles(paths as string[]));
    // M4 Task 6 (E1/L27): code index IPC. The embeddingFn defaults to the
    // deterministic local hashEmbedding; production Provider embedding (M1
    // ModelRouter extension) is a later swap — construct IndexStore with a
    // provider-backed EmbeddingFn here when it lands.
    const codeIndex = new IndexStore(createCodeIndexAdapter(this.db), hashEmbedding);
    this.register('index.reindex', async (_e, args) => {
      const { workspaceRoot } = args as { workspaceRoot: string };
      const res = await reindexWorkspace(codeIndex, workspaceRoot);
      return { ok: true, ...res };
    });
    this.register('index.search', (_e, args) => {
      const { query, limit } = args as { query: string; limit?: number };
      return codeIndex.search(query, limit ?? 5);
    });
    // M4 Task 8 (E9/E6): diff apply/read + mention search IPC.
    // diff.applyAll/read target the single-active workspace (same getWorkspace
    // assumption as workspace.tree) and read the task's snapshot for the base.
    const snapshotStore = createSnapshotStore(this.db);
    this.register('diff.applyAll', (_e, args) => {
      const { taskId, path, accepts } = args as { taskId: string; path: string; accepts: boolean[] };
      const ws = getWorkspace();
      if (!ws) return { ok: false, error: 'no workspace' };
      return applyDiffToFile(ws, path, accepts, taskId, snapshotStore);
    });
    this.register('diff.read', (_e, args) => {
      const { taskId, path } = args as { taskId: string; path: string };
      const ws = getWorkspace();
      if (!ws) return { ok: false, error: 'no workspace' };
      return readDiffFile(ws, path, taskId, snapshotStore);
    });
    // mention.search binds the code index, the agent list, and a flattened
    // workspace tree (the current agent's workspace) so the renderer's
    // `mention.search(query)` single-arg call works end to end.
    const flattenTree = (nodes: TreeNode[]): Array<{ path: string; type: string }> => {
      const out: Array<{ path: string; type: string }> = [];
      const walk = (ns: TreeNode[]) => { for (const n of ns) { out.push({ path: n.path, type: n.type }); walk(n.children); } };
      walk(nodes);
      return out;
    };
    this.register('mention.search', async (_e, query) => {
      return searchMentions(query as string, codeIndex, agents.list(), () => flattenTree(workspaceIpc.tree()));
    });
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
    const tasks = registerTaskHandlers(this.db, secrets, () => BrowserWindow.getFocusedWindow(), createAgentStore(this.db), { settings });
    this.register(IpcChannel.taskCreate, (e, args) => tasks.create(e, args as { agentId: string; prompt: string; sessionId?: string }));
    this.register(IpcChannel.taskCancel, (_e, id) => tasks.cancel(_e, id as string));
    this.register(IpcChannel.taskPause, (_e, id) => tasks.pause(_e, id as string));
    this.register('task.resume', (_e, id) => tasks.resume(_e, id as string));
    this.register(IpcChannel.taskRetry, (_e, id) => tasks.retry(_e, id as string));
    this.register('task.rollback', (_e, id) => tasks.rollback(_e, id as string));
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
    // M5 Task 1 (D4): 划词 analysis channel. The office router's `register`
    // shape accepts a generic handler; IpcRouter.register expects the electron
    // Handler (event first), so wrap it. The modelRouter is a streaming adapter
    // bridge over the first agent's model binding (see ./office).
    // settings + secrets let the office.image.generate channel resolve its API
    // key the same way other channels do (settings `image.api_key_ref` → keychain).
    registerOfficeIpc({ register: (ch, h) => this.register(ch, h) }, createOfficeChatStream(this.db, secrets), { settings, secrets });
  }

  listen(): void {
    for (const [channel, handler] of this.handlers) {
      ipcMain.handle(channel, handler);
    }
  }
}
