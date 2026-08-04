import type { BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { IpcEvent } from '@jarvis/protocol';
import { AgentEngine, ToolRegistry, TaskOrchestrator, createAdapter, buildContextMessages, mergeEnv, createChatService, createFileTools, createShellTool, createGitTools, Sandbox, createApprovalGate, scanSkillsDir, buildSkillInjection } from '@jarvis/core';
import { registerAgentMcpTools } from './mcp';
import type { EngineChatFn, SandboxPolicy, Usage } from '@jarvis/core';
import { createAgentStore } from './agents';
import { createChatDbAdapter } from './chat';
import { createWorkspaceService } from './workspace';
import type { SettingsStore } from './settings';
import { ApprovalCenter } from '../approval/ApprovalCenter';
import type { SecureStorage } from '../secrets/SecureStorage';
import type { AgentConfig } from '@jarvis/protocol';

// In-memory per-task log buffer. Streaming to the renderer is the sole
// responsibility of the orchestrator's cb.onLog (IpcEvent.taskLog), so task
// deltas are emitted exactly once; this buffer preserves them for later reads.
const taskLogs = new Map<string, string[]>();

export interface TaskHandlerDeps {
  chatFn?: EngineChatFn;
  maxSteps?: number;
  // M3 Task 9 (C6/J6): settings store used to resolve the per-agent sandbox
  // policy saved by the PermissionsSettingsPage. Falls back to the default
  // readwrite policy when absent.
  settings?: SettingsStore;
}

export function registerTaskHandlers(db: Database.Database, secrets: SecureStorage, getWindow: () => BrowserWindow | null, agentStore = createAgentStore(db), deps: TaskHandlerDeps = {}) {
  const workspace = createWorkspaceService(db);
  const chatService = createChatService(createChatDbAdapter(db));
  // Map task id -> chat session id so task completion can persist the assistant
  // turn into the same session that launched it (M1 session list + reload stays
  // working while M2 executes the task through the task path).
  const taskSessions = new Map<string, string>();

  // The model adapters stream deltas via onChunk and return void, while
  // EngineChatFn must RETURN { text, usage } (the AgentEngine destructures it).
  // Wrap the adapter so delta text is accumulated, the usage chunk is captured,
  // every chunk is forwarded to opts.onChunk, and opts.signal is passed through.
  // The adapter is selected per-request from req.provider.type so an
  // anthropic-compatible provider gets the Anthropic adapter, not OpenAI.
  const defaultChatFn: EngineChatFn = async (req, opts) => {
    const adapter = createAdapter(req.provider.type);
    let text = '';
    let usage: Usage | null = null;
    await adapter.chat(req, {
      apiKey: opts.apiKey,
      signal: opts.signal,
      onChunk: (c) => {
        if (c.kind === 'delta') text += c.delta;
        else if (c.kind === 'usage') usage = c.usage;
        opts.onChunk?.(c);
      }
    });
    return { text, usage };
  };
  const chatFn = deps.chatFn ?? defaultChatFn;
  // The engine is shared across tasks while each agent has its own workspace.
  // Tools therefore build a Sandbox per-execution from ctx.workspaceRoot (set
  // per-submit from the agent's workspaceId), not from a fixed registration-time
  // sandbox. An empty allowCommands list falls back to the sandbox default
  // whitelist at readwrite level.
  const toolRegistry = new ToolRegistry();
  const toolPolicy: SandboxPolicy = { level: 'readwrite', allowDomains: [], allowCommands: [] };
  createFileTools(toolRegistry, toolPolicy);
  createShellTool(toolRegistry, toolPolicy);
  // M3 Task 7 (E4): git tools. The brief's createGitTools captures a fixed
  // Sandbox root at registration, while the engine forwards a per-task
  // workspaceRoot — so the git sandbox is rooted at the process cwd (the
  // default '.' workspace). Workspaces bound outside the app directory won't
  // pass the assert; a per-task git sandbox is deferred (see task-7-report).
  createGitTools(toolRegistry, new Sandbox(process.cwd(), toolPolicy));
  const approvalGate = createApprovalGate();
  const approval = new ApprovalCenter(getWindow);
  const engine = new AgentEngine({
    modelRouter: { chat: chatFn },
    toolRegistry,
    maxSteps: deps.maxSteps ?? 10,
    approvalGate: async (req) => {
      // G8: previously-approved mcp:{server}:{tool} calls are auto-allowed by
      // folding the grants rows into allowAlways (granted=1 rows).
      const grants = db.prepare('SELECT server_id, tool_name FROM mcp_grants WHERE granted = 1').all() as Array<{ server_id: string; tool_name: string }>;
      const allowAlways = ['read_file', 'list_dir', ...grants.map(g => `mcp:${g.server_id}:${g.tool_name}`)];
      const decision = approvalGate.evaluate(req.toolName, req.args, { allowAlways, sensitiveCommands: [] });
      // M3 Task 7 gap fix: git_commit is a mutating git tool that the
      // ApprovalGate's shell-command regexes can never see (it has no
      // args.command), so force it through interactive approval.
      if (decision === 'allow' && req.toolName !== 'git_commit') return true;
      const ok = await approval.request(req);
      appendAudit(db, { agentId: null, kind: 'approval', detail: { toolName: req.toolName, ok } });
      // G8/J7: a denied-then-approved mcp call writes a grant so the next call
      // hits allowAlways and skips approval. agent_id is left '' (unbound): the
      // schema is NOT NULL and ApprovalRequest carries no agent id today, so
      // grants are server-wide rather than per-agent (documented).
      if (ok && req.toolName.startsWith('mcp:')) {
        const seg = req.toolName.slice('mcp:'.length).split(':');
        if (seg.length >= 2) {
          db.prepare('INSERT INTO mcp_grants (id, agent_id, server_id, tool_name, granted, created_at) VALUES (?,?,?,?,?,?)')
            .run(randomUUID(), '', seg[0], seg.slice(1).join(':'), 1, new Date().toISOString());
        }
      }
      return ok;
    }
  });
  const store = {
    async create(id: string, agentId: string) {
      db.prepare('INSERT INTO tasks (id, agent_id, status, payload_json, created_at) VALUES (?,?,?,?,?)').run(id, agentId, 'queued', '{}', new Date().toISOString());
    },
    async updateState(id: string, state: string) { db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(state, id); },
    // Keep logs in an in-memory buffer. The streaming path to the renderer is
    // the orchestrator's cb.onLog -> IpcEvent.taskLog (see below); persisting
    // here would emit each line a second time.
    async appendLog(id: string, line: string) {
      const buf = taskLogs.get(id) ?? [];
      buf.push(line);
      taskLogs.set(id, buf);
    }
  };

  const orchestrator = new TaskOrchestrator(engine, store, {
    onStateChange: (id, state) => { getWindow()?.webContents.send(IpcEvent.taskState, { id, state }); },
    onLog: (id, line) => { getWindow()?.webContents.send(IpcEvent.taskLog, { id, line }); },
    onDone: (id, ok, text) => {
      db.prepare('UPDATE tasks SET status = ?, result_json = ?, completed_at = ? WHERE id = ?').run(ok ? 'completed' : 'failed', JSON.stringify({ text }), new Date().toISOString(), id);
      getWindow()?.webContents.send(ok ? IpcEvent.taskComplete : IpcEvent.taskFailed, { id, text });
      const sessionId = taskSessions.get(id);
      if (sessionId) void chatService.appendMessage(sessionId, 'assistant', text);
    }
  }, 6);

  return {
    approvalCenter: approval,
    async create(_event: Electron.IpcMainInvokeEvent, args: { agentId: string; prompt: string; sessionId?: string }) {
      const { agentId, prompt, sessionId } = args;
      const id = randomUUID();
      const agent = agentStore.get(agentId);
      const ctx = workspace.loadContext(agentId);
      const messages = buildTaskMessages(ctx, agent, prompt, agent.workspaceId ?? '.');
      const modelRow = db.prepare('SELECT m.model_id, p.base_url, p.type, p.api_key_ref FROM models m JOIN providers p ON p.id = m.provider_id WHERE m.id = ?').get(agent.modelId) as { model_id: string; base_url: string; type: 'openai-compatible' | 'anthropic-compatible'; api_key_ref: string } | undefined;
      if (!modelRow) throw new Error('agent has no valid model binding');
      const apiKey = await secrets.get(modelRow.api_key_ref);
      if (!apiKey) throw new Error('missing api key');
      // AgentConfig does not expose env_vars_json, so read the raw row to feed
      // the agent's env vars into the engine (I1).
      const agentRow = db.prepare('SELECT env_vars_json FROM agents WHERE id = ?').get(agentId) as { env_vars_json: string } | undefined;
      const agentEnv = agentRow ? (JSON.parse(agentRow.env_vars_json ?? '{}') as Record<string, string>) : {};
      const env = mergeEnv({}, {}, agentEnv, {});
      // C6/J6: read the per-agent sandbox policy the PermissionsSettingsPage
      // saved under settings.permissions.{agentId}; fall back to the shared
      // default readwrite policy (the one the tool registry was built with).
      const savedPolicy = deps.settings?.get(`permissions.${agentId}`) as { level?: 'readonly' | 'readwrite' | 'system'; allowCommands?: string[]; allowDomains?: string[] } | undefined;
      const policy: SandboxPolicy = {
        level: savedPolicy?.level ?? 'readwrite',
        allowCommands: savedPolicy?.allowCommands ?? [],
        allowDomains: savedPolicy?.allowDomains ?? []
      };
      await store.create(id, agentId);
      // G6: register the agent's bound MCP servers' tools into the shared
      // engine registry (filtered by config_json.agentIds). Clients are cached
      // per server id (see ./mcp) so repeated task runs reuse the same child
      // process instead of leaking one per run; failures are logged and skipped
      // so a bad server never blocks task creation.
      await registerAgentMcpTools(db, toolRegistry, agentId);
      if (sessionId) {
        taskSessions.set(id, sessionId);
        await chatService.appendMessage(sessionId, 'user', prompt);
      }
      orchestrator.submit({ id, agent, messages, cwd: agent.workspaceId ?? '.', env, apiKey, provider: { type: modelRow.type, baseUrl: modelRow.base_url }, modelId: modelRow.model_id, workspaceRoot: agent.workspaceId ?? '.', policy });
      return { id };
    },
    cancel: (_e: unknown, id: string) => orchestrator.cancel(id),
    pause: (_e: unknown, id: string) => orchestrator.pause(id),
    resume: (_e: unknown, id: string) => orchestrator.resume(id),
    retry: (_e: unknown, id: string) => orchestrator.retry(id)
  };
}

function buildTaskMessages(ctx: { jarvisMd: string; agentMd: string | null }, agent: AgentConfig, prompt: string, workspaceRoot: string): Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }> {
  const skills = scanSkillsDir(`${workspaceRoot}/.jarvis/skills`);
  const injection = buildSkillInjection(skills);
  const system = `${agent.systemPrompt}${injection}`;
  return buildContextMessages(ctx, system, [{ role: 'user', content: prompt }]);
}

// J5 base: audit trail for approval decisions (and other lifecycle events).
export function appendAudit(db: Database.Database, e: { agentId: string | null; kind: string; detail: unknown }): void {
  db.prepare('INSERT INTO audit_logs (id, agent_id, kind, detail_json, created_at) VALUES (?,?,?,?,?)')
    .run(randomUUID(), e.agentId, e.kind, JSON.stringify(e.detail), new Date().toISOString());
}
