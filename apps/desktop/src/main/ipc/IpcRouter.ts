import { app, ipcMain, BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { join } from 'node:path';
import { IpcChannel } from '@jarvis/protocol';
import { exportSessionMarkdown, IndexStore, hashEmbedding, substituteTemplate, type TreeNode, type WipeScope, type ImportStrategy, type ShortcutBindings } from '@jarvis/core';
import { createCodeIndexAdapter, reindexWorkspace, applyDiffToFile, readDiffFile, createSnapshotStore } from './coding';
import { searchMentions } from './mention';
import { createSettingsStore } from './settings';
import { createProviderStore, type ProviderInput, type ModelInput } from './providers';
import { createAgentStore, type AgentInput } from './agents';
import { createAgentTemplatesIpc } from './agent-templates';
import { createMcpStore, testMcpServerById, type McpServerInput } from './mcp';
import { createSkillsStore } from './skills';
import { createWorkspaceIpc, createWorkspaceService } from './workspace';
import { createTemplatesStore } from './templates';
import { createBusPersist, createSquadEventPush, getMessageBus, registerSquadIpc } from './squad';
import { globalSearch, configureWebSearch, createSearchProviderIpc } from './search';
import { registerChatHandlers } from './chat';
import { registerRuntimeHandlers } from './runtime';
import { registerTaskHandlers } from './tasks';
import { createTaskboardIpc } from './taskboard';
import { createUsageIpc } from './usage';
import { createShortcutsIpc } from './shortcuts';
import { createAuditIpc } from './audit';
import { createArtifactsIpc } from './artifacts';
import { createBackupIpc } from './backup';
import { createWipeIpc } from './wipe';
import { createConfigIpc } from './config';
import { BackupService } from '../backup/BackupService';
import { WipeService } from '../wipe/WipeService';
import { UsageTracker } from '../usage/UsageTracker';
import { registerOfficeIpc, createOfficeChatStream } from './office';
import { testProviderConnectivity, runDiagnostics } from './diagnostics';
import { collectEnvInfo } from '../diagnostics/env';
import { DaemonSupervisor } from '../daemon/DaemonSupervisor';
import { SecureStorage } from '../secrets/SecureStorage';
import { TrustedRendererPolicy, assertTrustedIpcEvent } from '../security/TrustedRendererPolicy';
import { PathCapabilityStore, type PathOperation, type PathPickPurpose } from '../security/PathCapabilityStore';
import { SafeUrlPolicy } from '../security/SafeUrlPolicy';
import { jarvisDataDir } from '../db/connection';
import { setDefaultWebSearchHttp } from './search';
import { sqliteAuditSink } from '../audit/sqliteAuditSink';

type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown;

export interface IpcRouterOptions {
  getMainWindow?: () => BrowserWindow | null;
  rendererRoot?: string;
}

export interface IpcRouterSearchOptions {
  migrationBlocked?: boolean;
}

export class IpcRouter {
  private handlers = new Map<string, Handler>();
  private readonly policy: TrustedRendererPolicy;
  private readonly capabilities = new PathCapabilityStore();
  // Teardown handles for resources registerAll subscribes to (the bus persist
  // subscription). dispose() drops them so a discarded router never fires into
  // a stale db (M6 Task 1 review fix — the singleton persists across routers).
  private disposeFns: Array<() => void> = [];
  constructor(private db: Database.Database, private opts: IpcRouterOptions = {}) {
    const rendererRoot = opts.rendererRoot ?? join(import.meta.dirname, '../renderer');
    this.policy = new TrustedRendererPolicy({
      rendererRoot,
      devOrigin: process.env['ELECTRON_RENDERER_URL'],
    });
  }

  register(channel: string, handler: Handler): void {
    this.handlers.set(channel, handler);
  }

  revokeCapabilitiesForWindow(ownerWebContentsId: number): void {
    this.capabilities.revokeWindow(ownerWebContentsId);
  }

  /** Call after the main BrowserWindow exists (bootstrap creates window after listen()). */
  attachMainWindowRevoke(win: BrowserWindow): void {
    if (win.isDestroyed?.() === true || typeof win.on !== 'function') return;
    const ownerId = win.webContents.id;
    const revoke = () => this.revokeCapabilitiesForWindow(ownerId);
    win.on('closed', revoke);
    win.webContents.on?.('destroyed', revoke);
  }

  private resolvePath(token: string, owner: number, operation: PathOperation): string {
    return this.capabilities.resolve(token, owner, operation);
  }

  registerAll(daemon: DaemonSupervisor, backup?: BackupService, searchOpts: IpcRouterSearchOptions = {}): void {
    const settings = createSettingsStore(this.db);
    const safeUrlPolicy = new SafeUrlPolicy({
      allowLoopbackDev: process.env['JARVIS_ALLOW_LOOPBACK_URLS'] === '1',
    });
    setDefaultWebSearchHttp(safeUrlPolicy);
    const secrets = new SecureStorage();
    configureWebSearch({ secrets, migrationBlocked: searchOpts.migrationBlocked ?? false });
    const assertAllowedUrl = async (url: string) => { await safeUrlPolicy.assertAllowed(url); };
    // C5 (M8 Task 7): in-app shortcut bindings read/write the `shortcuts`
    // settings key (merged over defaults). The renderer's useShortcuts hook +
    // ShortcutsSettingsView are the only consumers.
    const shortcuts = createShortcutsIpc(k => settings.get(k), (k, v) => settings.set(k, v));
    this.register('shortcuts.get', () => shortcuts.get());
    this.register('shortcuts.set', (_e, bindings) => shortcuts.set(_e, bindings as ShortcutBindings));
    const providers = createProviderStore(this.db, secrets, { assertAllowedUrl });
    const agents = createAgentStore(this.db);
    this.register(IpcChannel.agentList, () => agents.list());
    this.register(IpcChannel.agentCreate, (_e, input) => agents.create(input as AgentInput));
    this.register(IpcChannel.agentUpdate, (_e, id, patch) => agents.update(id as string, patch as Partial<AgentInput>));
    this.register(IpcChannel.agentDelete, (_e, id) => agents.remove(id as string));
    // M6 Task 9 (L31): agent config version history + rollback. Both channels
    // take a SINGLE object payload ({ id } / { id, versionId }) — the preload
    // spreads positional args, so the object shape is the contract (a two-arg
    // call would leave the destructure undefined; see VersionHistoryPage).
    // Handlers return { ok, ... } / { ok, error } so an ipcMain rejection never
    // leaks (same contract as squad.*/templates.*). The version store lives on
    // the agent store (agents.versions) so the update path and these channels
    // share ONE snapshot history.
    this.register(IpcChannel.agentVersions, (_e, args) => {
      try {
        const { id } = (args ?? {}) as { id: string };
        // Lax input validation: an unknown agent id is an error, not an empty
        // list (get throws 'agent not found' -> { ok:false }).
        agents.get(id);
        return { ok: true as const, versions: agents.versions.list(id) };
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
      }
    });
    this.register(IpcChannel.agentRollback, (_e, args) => {
      try {
        const { id, versionId } = (args ?? {}) as { id: string; versionId: string };
        // Cross-agent guard: a cheap PK+agent_id existence check (NOT a full
        // list() with a JSON.parse per snapshot) so a stale client cannot roll
        // an agent to another agent's snapshot. rollback() itself is also scoped
        // by agent_id for defense-in-depth, and applies the snapshot through a
        // snapshot-free raw write (applyRaw in agents.ts) so it restores the
        // config without recording a brand-new version.
        if (!this.db.prepare('SELECT 1 FROM agent_config_versions WHERE id = ? AND agent_id = ?').get(versionId, id)) {
          return { ok: false as const, error: `version ${versionId} not found for agent ${id}` };
        }
        agents.versions.rollback(versionId, id);
        return { ok: true as const };
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
      }
    });
    // L30 (M8 Task 8): agent template library. `list` returns the seed presets;
    // `createAgent` resolves the template's systemPrompt and threads it into the
    // REAL agent store create. Skills are global/filesystem-injected (not
    // per-agent), so no skills field is passed — AgentInput has none. Channel
    // prefix `agent-templates.*` (NOT `templates.*`, which D15's prompt-template
    // store owns). The template has no modelId (Q4), so creation is modelId:null.
    const agentTemplates = createAgentTemplatesIpc((input: { name: string; systemPrompt: string; workspaceId: string | null }) =>
      agents.create({ name: input.name, systemPrompt: input.systemPrompt, modelId: null, workspaceId: input.workspaceId }));
    this.register('agent-templates.list', () => agentTemplates.list());
    this.register('agent-templates.createAgent', (_e, input) => agentTemplates.createAgent(_e, input as { templateId: string; name: string; workspaceId?: string }));
    const mcpStore = createMcpStore(this.db);
    // Pass the agents store so skills import can copy SKILL.md into every bound
    // workspace's .jarvis/skills/ (the runtime injection surface), J2 fix.
    const skillsStore = createSkillsStore(this.db, agents, {
      root: join(jarvisDataDir(), 'skills'),
      http: safeUrlPolicy,
    });
    this.register('mcp.list', () => mcpStore.list());
    this.register('mcp.create', (_e, input) => mcpStore.create(input as McpServerInput));
    this.register('mcp.delete', (_e, id) => mcpStore.remove(id as string));
    this.register('mcp.test', (_e, args) =>
      testMcpServerById(this.db, ((args ?? {}) as { id: string }).id));
    this.register('skills.list', () => skillsStore.list());
    this.register('skills.importLocal', (_e, req) => {
      const dir = this.resolvePath((req as { capability: string }).capability, _e.sender.id, 'skills:import-dir');
      return skillsStore.importFromDir(dir);
    });
    this.register('skills.importUrl', async (_e, req) => {
      try {
        const { url } = (req ?? {}) as { url: string };
        const skill = await skillsStore.importFromUrl(url);
        return { ok: true as const, skill };
      } catch (e) {
        const code = e instanceof Error ? e.message : 'SKILL_IMPORT_FAILED';
        return { ok: false as const, error: code };
      }
    });
    this.register('skills.delete', (_e, id) => skillsStore.remove(id as string));
    const workspace = createWorkspaceService(this.db);
    this.register('workspace.bind', (_e, agentId, req) => {
      const path = this.resolvePath((req as { capability: string }).capability, _e.sender.id, 'workspace:bind');
      workspace.bind(agentId as string, path);
      return { ok: true };
    });
    this.register('workspace.listBound', () => workspace.listBound());
    this.register('workspace.loadContext', (_e, agentId) => workspace.loadContext(agentId as string));
    // M4 Task 7 (E11/K3): code-panel tree/read IPC. Single-active assumption: the
    // code panel targets ONE workspace — the first agent that has one bound. This
    // mirrors the renderer agent-store, where `current` falls back to agents[0].
    const getWorkspace = (): string | null => agents.list().find(a => a.workspaceId)?.workspaceId ?? null;
    const workspaceIpc = createWorkspaceIpc(getWorkspace, { resolvePath: (token, owner, op) => this.resolvePath(token, owner, op) });
    this.register('workspace.tree', () => workspaceIpc.tree());
    this.register('workspace.read', (_e, rel) => workspaceIpc.read(rel as string));
    // M5 Task 7 (L22): dropped non-attach files are copied into the active
    // workspace (see createWorkspaceIpc.copyFiles).
    this.register('workspace.copyFiles', (_e, req) => {
      const { capabilities } = (req ?? {}) as { capabilities: string[] };
      return workspaceIpc.copyFiles(capabilities, _e.sender.id);
    });
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
    const PICK_POLICIES: Record<PathPickPurpose, {
      kind: 'file' | 'directory';
      operations: PathOperation[];
      filters?: Electron.FileFilter[];
    }> = {
      'office-file': { kind: 'file', operations: ['office:read'] },
      'workspace-copy': { kind: 'file', operations: ['workspace:copy'] },
      'workspace-bind': { kind: 'directory', operations: ['workspace:bind'] },
      'skills-import': { kind: 'directory', operations: ['skills:import-dir'] },
      'config-import': { kind: 'file', operations: ['config:read'], filters: [{ name: 'JARVIS config', extensions: ['json', 'yaml', 'yml'] }] },
    };
    this.register('dialog.pickPath', async (event, request) => {
      const { purpose, multiple } = (request ?? {}) as { purpose: PathPickPurpose; multiple?: boolean };
      const policy = PICK_POLICIES[purpose];
      if (!policy) throw new Error('PATH_PICK_PURPOSE_INVALID');
      const { dialog } = await import('electron');
      const r = await dialog.showOpenDialog({
        properties: policy.kind === 'directory'
          ? ['openDirectory']
          : ['openFile', ...(multiple ? ['multiSelections' as const] : [])],
        filters: policy.filters ?? [],
      });
      return r.canceled ? [] : r.filePaths.map(path =>
        this.capabilities.issue(path, event.sender.id, policy.operations));
    });
    this.register('config.readPickedFile', async (event, req) => {
      try {
        const { readFileSync } = await import('node:fs');
        const path = this.resolvePath((req as { capability: string }).capability, event.sender.id, 'config:read');
        return readFileSync(path, 'utf8');
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
      }
    });
    // M8 Task 3 (J5): save-text dialog used by the audit view's CSV/JSONL
    // export. Takes a single { defaultName, content } payload and returns
    // { ok } / { ok: false, error } so a canceled dialog or write failure is a
    // clean value, never an ipcMain rejection.
    this.register('dialog.saveText', async (_e, args) => {
      try {
        const { defaultName, content } = (args ?? {}) as { defaultName: string; content: string };
        const { dialog } = await import('electron');
        const { writeFile } = await import('node:fs/promises');
        const r = await dialog.showSaveDialog({ defaultPath: defaultName });
        if (r.canceled || !r.filePath) return { ok: false as const };
        await writeFile(r.filePath, content, 'utf8');
        return { ok: true as const };
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
      }
    });
    this.register(IpcChannel.providerList, () => providers.list());
    this.register(IpcChannel.providerCreate, (_e, input) => providers.create(input as ProviderInput));
    this.register(IpcChannel.providerUpdate, (_e, id, patch) => providers.update(id as string, patch as Partial<ProviderInput>));
    this.register(IpcChannel.providerDelete, (_e, id) => providers.remove(id as string));
    this.register('provider.listModels', (_e, providerId) => providers.listModels(providerId as string));
    this.register('provider.addModel', (_e, providerId, input) => providers.addModel(providerId as string, input as ModelInput));
    // M8 Task 2 (B9): ONE shared token-usage sink feeds the chat path, the task
    // path, and the usage.* IPC channels.
    const usageTracker = new UsageTracker(this.db);
    const chat = registerChatHandlers(this.db, secrets, () => BrowserWindow.getFocusedWindow(), { usageTracker });
    this.register(IpcChannel.chatSend, (e, args) => chat.send(e, args as Parameters<typeof chat.send>[1]));
    this.register('chat.listSessions', () => chat.listSessions());
    this.register('chat.createSession', (_e, title) => chat.createSession(title as string | undefined));
    this.register('chat.loadMessages', (_e, sessionId) => chat.loadMessages(sessionId as string));
    const tasks = registerTaskHandlers(this.db, secrets, () => BrowserWindow.getFocusedWindow(), createAgentStore(this.db), { settings, usageTracker });
    this.register(IpcChannel.taskCreate, (e, args) => tasks.create(e, args as { agentId: string; prompt: string; sessionId?: string }));
    this.register(IpcChannel.taskCancel, (_e, id) => tasks.cancel(_e, id as string));
    this.register(IpcChannel.taskPause, (_e, id) => tasks.pause(_e, id as string));
    this.register('task.resume', (_e, id) => tasks.resume(_e, id as string));
    this.register(IpcChannel.taskRetry, (_e, id) => tasks.retry(_e, id as string));
    this.register('task.rollback', (_e, id) => tasks.rollback(_e, id as string));
    this.register('approval.resolve', (_e, id, ok) => { tasks.approvalCenter.resolve(id as string, ok as boolean); return { ok: true }; });
    // K4 Task 看板 (M8 Task 1): read-only board list. Mutations reuse the
    // task.cancel/pause/resume/retry channels above.
    const taskboard = createTaskboardIpc(this.db);
    this.register('taskboard.list', () => taskboard.list());
    // M8 Task 2 (B9): token usage dashboard data plane. Read-only channels over
    // the same tracker the chat/task paths write.
    const usage = createUsageIpc(usageTracker);
    this.register('usage.summary', () => usage.summary());
    this.register('usage.list', (_e, agentId) => usage.list(agentId as string | undefined));
    // M8 Task 3 (J5): audit log data plane. Read/export only; writes flow
    // through the sqliteAuditSink wired into registerTaskHandlers (onExec +
    // approval-gate denials), not through IPC.
    const audit = createAuditIpc(this.db);
    this.register('audit.list', (_e, filter) => audit.list(filter as { kind?: string; result?: string }));
    this.register('audit.export', (_e, filter) => audit.exportAudit(filter as { kind?: string; result?: string; format?: 'csv' | 'jsonl' }));
    // M8 Task 10 (K6): canvas workspace artifact data plane. The task
    // completion path writes rows directly via the SAME createArtifactsIpc (in
    // tasks.ts onDone); these channels let the renderer CanvasView read them
    // back. `save` exists as an IPC channel for completeness/debugging, but the
    // production write path is the in-process onDone capture.
    const artifacts = createArtifactsIpc(this.db);
    this.register('artifacts.list', (_e, taskId) => artifacts.list(_e, taskId as string));
    this.register('artifacts.save', (_e, a) => artifacts.save(_e, a as Parameters<typeof artifacts.save>[1]));
    // L18 (M8 Task 4): SQLite auto-backup + restore. The BackupService is
    // constructed in bootstrap (it also drives the interval + quit backup) and
    // threaded in here so the renderer can list/create/restore backups. restore
    // closes the db, so the service returns restart:true and the renderer
    // relaunches via app.relaunch immediately after.
    if (backup) {
      const backupIpc = createBackupIpc(backup);
      this.register('backup.list', () => backupIpc.list());
      this.register('backup.create', async () => backupIpc.create());
      this.register('backup.restore', async (_e, file) => backupIpc.restore(_e, file as string));
    }
    // L18: `app.relaunch` does not exist on the preload surface — the renderer's
    // BackupPane invokes it after a restore, so expose it here (relaunch then quit).
    this.register('app.relaunch', () => { app.relaunch(); app.quit(); return { ok: true }; });
    // L20 (M8 Task 5): sensitive-data wipe. The WipeService deletes the
    // DEFAULT_WIPE_TABLES rows, then the Keychain API keys and the single-active
    // workspace root when the scope asks for them. deleteAllApiKeys enumerates
    // every persisted api_key_ref (providers + the settings image.api_key_ref)
    // and best-effort deletes each — a missing keychain item must not abort the
    // wipe (SecureStorage.delete throws when the item is absent).
    const wipeSvc = new WipeService(this.db, {
      deleteAllApiKeys: async () => {
        const refs: string[] = (this.db.prepare('SELECT api_key_ref FROM providers').all() as Array<{ api_key_ref: string }>)
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
    this.register('wipe.run', (_e, scope, phrase) => wipeIpc.run(_e, scope as WipeScope, phrase as string));
    // M6 Task 3 (F8/F9): squad IPC. The runner from registerTaskHandlers drives
    // the leader/member engine runs through the SAME shared engine; the store
    // persists to the squads table (migration v5). The `{ ok, error }` contract
    // is enforced inside registerSquadIpc, so no ipcMain rejection leaks.
    registerSquadIpc((ch, h) => this.register(ch, h), { db: this.db, getWindow: () => BrowserWindow.getFocusedWindow(), runner: tasks.squad });
    this.register(IpcChannel.settingsGet, (_e, key) => settings.get(key as string));
    this.register(IpcChannel.settingsSet, (_e, key, value) => { settings.set(key as string, value); });
    this.register('proxy.get', () => settings.getAll().proxy_json ?? { mode: 'none' });
    this.register('proxy.set', (_e, cfg: unknown) => { settings.set('proxy_json', cfg); return { ok: true }; });
    // C12 (M8 Task 6): config import/export. Export serializes the providers/
    // models/agents/settings tables (apiKeyRef only, never plaintext keys);
    // import applies a skip/overwrite/merge strategy over the same tables.
    const config = createConfigIpc(this.db, settings.get);
    this.register('config.export', (_e, format) => config.exportConfig(format as 'json' | 'yaml'));
    this.register('config.import', (_e, text, strategy) => config.importConfig(text as string, strategy as ImportStrategy));
    this.register(IpcChannel.secretsSet, async (_e, key, value) => { await secrets.set(key as string, value as string); return { ok: true }; });
    this.register(IpcChannel.secretsGet, async (_e, key) => secrets.get(key as string));
    this.register(IpcChannel.secretsDelete, async (_e, key) => { await secrets.delete(key as string); return { ok: true }; });
    this.register(IpcChannel.daemonStatus, () => daemon.status());
    this.register(IpcChannel.daemonRestart, () => { daemon.restart(); return { ok: true }; });
    // M7 Task 9 (L39/L38 数据面): runtime status/conflicts come from the
    // supervisor's polled caches; conflict decisions are persisted to settings
    // as the main-owned `multica.conflicts` map (main 属主).
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
    registerOfficeIpc({ register: (ch, h) => this.register(ch, h) }, createOfficeChatStream(this.db, secrets), {
      settings,
      secrets,
      resolvePath: (token, owner, op) => this.resolvePath(token, owner, op),
      assertAllowedUrl,
    });
    // M5 Task 9 (D15): prompt template library. The store is main-owned; the
    // render channel substitutes {{var}} placeholders against the template body.
    // An unknown id returns { ok:false } instead of an ipcMain rejection so the
    // renderer can surface it without an unhandled promise rejection (same
    // contract as the office.* channels).
    const templates = createTemplatesStore(this.db);
    this.register('templates.list', () => templates.list());
    this.register('templates.create', (_e, input) => templates.create(input as { name: string; content: string }));
    // update throws on a missing id (store guard); catch it so the channel
    // returns { ok:false, error } like render instead of an ipcMain rejection.
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
    // M5 Task 10 (L21): global FTS5 search across chat_messages/agents/tasks.
    // Wrap the MATCH so a malformed query returns { ok:false, error } instead
    // of rejecting the channel. Search provider credentials are managed via
    // search.providers.get/set (apiKeyRef + SecureStorage, never plaintext).
    const searchProviders = createSearchProviderIpc(this.db, secrets, sqliteAuditSink(this.db));
    this.register('search.providers.get', () => ({ ok: true as const, configs: searchProviders.getConfigs() }));
    this.register('search.providers.set', async (_e, inputs) => {
      try {
        const configs = await searchProviders.save(inputs as Parameters<typeof searchProviders.save>[0]);
        return { ok: true as const, configs };
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
      }
    });
    this.register('search.global', (_e, args) => {
      try {
        const { query } = (args ?? {}) as { query?: string };
        return { ok: true as const, results: globalSearch(this.db, query ?? '') };
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
      }
    });
    // M6 Task 1 (L12): agent message bus. getMessageBus returns the shared
    // in-memory bus singleton; createBusPersist subscribes it to agent_messages
    // so every posted message is durable (main-owned table, §13.3). No IPC
    // channels yet — the renderer does not consume the bus in this task. The
    // unsubscribe is retained so dispose() can drop it (see disposeFns).
    this.disposeFns.push(createBusPersist(this.db, getMessageBus()));
    // K5 (M6 Task 10): forward squad/agent bus messages to the renderer as
    // 'squad:event' so the squad timeline (TimelineView) streams live. Same
    // disposeFns lifecycle as the persist subscription.
    this.disposeFns.push(createSquadEventPush(getMessageBus(), () => BrowserWindow.getFocusedWindow()));
  }

  listen(): void {
    const getMainWindow = (): BrowserWindow | null => this.opts.getMainWindow?.() ?? null;
    for (const [channel, handler] of this.handlers) {
      ipcMain.handle(channel, async (event, ...args) => {
        assertTrustedIpcEvent(event, getMainWindow(), this.policy);
        return handler(event, ...args);
      });
    }
  }

  // Releases resources registerAll subscribed (currently the bus persist
  // subscription). Safe to call once; no-op afterwards.
  dispose(): void {
    for (const fn of this.disposeFns) fn();
    this.disposeFns = [];
  }
}
