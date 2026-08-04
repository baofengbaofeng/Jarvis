import type { BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { IpcEvent } from '@jarvis/protocol';
import { AgentEngine, ToolRegistry, TaskOrchestrator, createAdapter, buildContextMessages, mergeEnv, createChatService, createFileTools, createShellTool, createGitTools, registerRunTestsTool, createApprovalGate, scanSkillsDir, buildSkillInjection, restoreSnapshot, parseMentions, resolveFileMention, buildMentionBlock, isPlanBlocked, planVisibleTools } from '@jarvis/core';
import { registerAgentMcpTools } from './mcp';
import type { EngineChatFn, SandboxPolicy, Usage, ContextAttachment } from '@jarvis/core';
import { createAgentStore } from './agents';
import { createChatDbAdapter } from './chat';
import { createWorkspaceService } from './workspace';
import type { SettingsStore } from './settings';
import { ApprovalCenter } from '../approval/ApprovalCenter';
import type { SecureStorage } from '../secrets/SecureStorage';
import type { AgentConfig } from '@jarvis/protocol';
import { createSnapshotStore, snapshotBeforeTask, createSnapshotGit, createSnapshotFs } from './coding';

// In-memory per-task log buffer. Streaming to the renderer is the sole
// responsibility of the orchestrator's cb.onLog (IpcEvent.taskLog), so task
// deltas are emitted exactly once; this buffer preserves them for later reads.
const taskLogs = new Map<string, string[]>();

// M3 final review (J2): per-agent MCP grant isolation. The engine is shared
// across tasks, so the approval gate (which runs inside the engine) has no
// notion of "the current agent". tasks.create sets this module-level id before
// submitting a task and the approval gate reads it to scope mcp_grants writes
// and lookups. Documented single-active-task assumption for M3: with a shared
// engine, the grant consult/write reflects the agent of the most recently
// submitted task, so agent A's grant is never auto-allowed for agent B (the
// cheap isolation gap-fix; a full multi-agent rework is out of scope).
let currentAgentId: string | null = null;

// E10 (plan mode): plan-only flag for the shared engine's approval gate. The
// engine has no notion of "the current agent", so tasks.create sets this
// alongside currentAgentId under the same documented single-active-task
// assumption; the gate uses it to hard-block mutating tools at execution.
let currentPlanOnly = false;

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
  // M3 Task 7 (E4) + final review (J2): git tools build a per-execution
  // Sandbox from ctx.workspaceRoot (set per-submit from the agent's
  // workspaceId), so real bound workspaces outside process.cwd() pass the
  // assert. toolPolicy is the fallback policy (tools read ctx.policy first).
  createGitTools(toolRegistry, toolPolicy);
  // M4 Task 5 (E8): run_tests needs its own policy because the default `npm test`
  // is NOT in the sandbox DEFAULT_COMMAND_WHITELIST (no npm/pnpm/yarn) — without
  // an allowCommands entry carrying the project test commands, assertCommand
  // blocks the tool's default before it ever runs. registerRunTestsTool merges
  // these test commands into the effective per-agent policy so the default works
  // even under a saved empty allowlist; readonly agents stay blocked by the
  // readonly whitelist.
  const testPolicy: SandboxPolicy = { level: 'readwrite', allowDomains: [], allowCommands: ['npm test', 'pnpm test', 'yarn test'] };
  registerRunTestsTool(toolRegistry, testPolicy);
  const approvalGate = createApprovalGate();
  const approval = new ApprovalCenter(getWindow);
  const engine = new AgentEngine({
    modelRouter: { chat: chatFn },
    toolRegistry,
    maxSteps: deps.maxSteps ?? 10,
    approvalGate: async (req) => {
      // E10 (plan mode): a plan-only agent's mutating tool calls are blocked at
      // execution regardless of what the model attempts — before the normal
      // approval flow so the block is unconditional (no prompt, no grant write).
      if (currentPlanOnly && isPlanBlocked(req.toolName)) {
        appendAudit(db, { agentId: currentAgentId, kind: 'approval', detail: { toolName: req.toolName, ok: false, reason: 'plan_only_blocked' } });
        return false;
      }
      // G8: previously-approved mcp:{server}:{tool} calls are auto-allowed by
      // folding the grants rows into allowAlways (granted=1 rows). M3 final
      // review (J2): grants are consulted per-agent (the id set by
      // tasks.create), falling back to server-wide rows (agent_id = '') so
      // grants written before per-agent scoping still auto-allow.
      const grants = db.prepare('SELECT server_id, tool_name FROM mcp_grants WHERE granted = 1 AND (agent_id = ? OR agent_id = ?)').all(currentAgentId, '') as Array<{ server_id: string; tool_name: string }>;
      const allowAlways = ['read_file', 'list_dir', ...grants.map(g => `mcp:${g.server_id}:${g.tool_name}`)];
      const decision = approvalGate.evaluate(req.toolName, req.args, { allowAlways, sensitiveCommands: [] });
      // M3 Task 7 gap fix: git_commit is a mutating git tool that the
      // ApprovalGate's shell-command regexes can never see (it has no
      // args.command), so force it through interactive approval.
      if (decision === 'allow' && req.toolName !== 'git_commit') return true;
      const ok = await approval.request(req);
      appendAudit(db, { agentId: currentAgentId, kind: 'approval', detail: { toolName: req.toolName, ok } });
      // G8/J7: a denied-then-approved mcp call writes a grant so the next call
      // hits allowAlways and skips approval. The grant is scoped to the current
      // agent id (J2 per-agent isolation) rather than the old server-wide ''
      // sentinel, so another agent cannot inherit this approval.
      if (ok && req.toolName.startsWith('mcp:')) {
        const seg = req.toolName.slice('mcp:'.length).split(':');
        if (seg.length >= 2) {
          db.prepare('INSERT INTO mcp_grants (id, agent_id, server_id, tool_name, granted, created_at) VALUES (?,?,?,?,?,?)')
            .run(randomUUID(), currentAgentId ?? '', seg[0], seg.slice(1).join(':'), 1, new Date().toISOString());
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

  // M4 Task 2 (L26): per-task pre-run snapshot store (task_snapshots table).
  // snapshotBeforeTask is called right before the engine runs a task so
  // task.rollback can restore the workspace to its pre-task state.
  const snapshotStore = createSnapshotStore(db);

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
      // J2 per-agent MCP grants: scope the shared engine's approval gate to the
      // agent submitting this task (single-active-task assumption, documented
      // at the module-level currentAgentId declaration).
      currentAgentId = agentId;
      const id = randomUUID();
      const agent = agentStore.get(agentId);
      currentPlanOnly = agent.planOnly;
      const ctx = workspace.loadContext(agentId);
      const messages = buildTaskMessages(ctx, agent, prompt, agent.workspaceId ?? '.', db, currentAgentId);
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
      // E10 (plan mode): expose only the plan-safe tool subset to the model.
      // The approval gate above re-blocks the same tools at execution time; the
      // visible set is stored on the engine for the upcoming tools-field wiring
      // (ChatRequest.tools lands with the real-provider REACT rework).
      engine.setVisibleTools(planVisibleTools(toolRegistry.list().map(t => t.name), agent.planOnly));
      if (sessionId) {
        taskSessions.set(id, sessionId);
        await chatService.appendMessage(sessionId, 'user', prompt);
      }
      // M4 Task 2 (L26): snapshot the workspace BEFORE the engine runs, so
      // task.rollback can restore the exact pre-task state. The snapshot uses
      // the agent's REAL workspace root (same root the engine will operate in).
      // Agents without a bound workspace are skipped: snapshotting the app's own
      // cwd ('?? "."') would copy-on-write-mirror the entire app tree into
      // .jarvis/snapshots and is meaningless for rollback anyway (rollback
      // itself throws "no bound workspace" for these agents).
      if (agent.workspaceId) {
        await snapshotBeforeTask(agent.workspaceId, id, snapshotStore);
      }
      orchestrator.submit({ id, agent, messages, cwd: agent.workspaceId ?? '.', env, apiKey, provider: { type: modelRow.type, baseUrl: modelRow.base_url }, modelId: modelRow.model_id, workspaceRoot: agent.workspaceId ?? '.', policy });
      return { id };
    },
    cancel: (_e: unknown, id: string) => orchestrator.cancel(id),
    pause: (_e: unknown, id: string) => orchestrator.pause(id),
    resume: (_e: unknown, id: string) => orchestrator.resume(id),
    retry: (_e: unknown, id: string) => orchestrator.retry(id),
    // M4 Task 2 (L26): restore the pre-task snapshot and mark the task failed.
    // The tasks table has no workspace_id column — the workspace lives on the
    // AGENT (agent.workspaceId) — so resolve task -> agent_id -> agent ->
    // workspaceId, and restore against that workspace root.
    async rollback(_e: unknown, id: string) {
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as { agent_id: string } | undefined;
      if (!task) throw new Error(`task not found: ${id}`);
      const agent = agentStore.get(task.agent_id); // throws 'agent not found: ...' when missing
      const wsRoot = agent.workspaceId;
      if (!wsRoot) throw new Error(`agent ${agent.id} has no bound workspace; cannot roll back task ${id}`);
      await restoreSnapshot({ taskId: id, workspaceRoot: wsRoot, git: createSnapshotGit(), fs: createSnapshotFs(), store: snapshotStore });
      db.prepare('UPDATE tasks SET status = ?, result_json = ? WHERE id = ?').run('failed', JSON.stringify({ reason: 'rolled_back' }), id);
      getWindow()?.webContents.send(IpcEvent.taskState, { id, state: 'failed' });
      return { ok: true };
    }
  };
}

// M4 Task 3 (E6): @mention parsing + context attachment injection. readImpl is
// a real fs read — same try/readFileSync/null pattern as createSnapshotFs in
// ./coding — so @file mentions resolve against the agent's workspace root.
function readImpl(p: string): string | null {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

// E6 (review fix): strip ONLY the parsed raw token ranges (via the index
// recorded by parseMentions), never a fresh unanchored regex — so mid-word `@`
// (e.g. foo@bar.com) survives untouched. No global whitespace collapse, so
// indented/pasted code is preserved. Unresolved or out-of-workspace mentions
// are SKIPPED and audited, never fatal: a bad mention must not kill task
// creation. The assembled user message becomes `${input}${block}` so resolved
// file contents are injected verbatim into the model context.
function attachMentions(userInput: string, wsRoot: string, db: Database.Database, agentId: string | null): { input: string; block: string } {
  const mentions = parseMentions(userInput);
  const refs: ContextAttachment[] = [];
  for (const m of mentions) {
    try {
      refs.push(resolveFileMention(m.query, wsRoot, readImpl));
    } catch (err) {
      appendAudit(db, { agentId, kind: 'mention', detail: { query: m.query, error: err instanceof Error ? err.message : String(err) } });
    }
  }
  // Remove parsed token ranges in reverse order so earlier indices stay valid.
  let input = userInput;
  for (let i = mentions.length - 1; i >= 0; i--) {
    const m = mentions[i];
    input = input.slice(0, m.index) + input.slice(m.index + m.raw.length);
  }
  return { input, block: buildMentionBlock(refs) };
}

function buildTaskMessages(ctx: { jarvisMd: string; agentMd: string | null }, agent: AgentConfig, prompt: string, workspaceRoot: string, db: Database.Database, agentId: string | null): Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }> {
  const skills = scanSkillsDir(`${workspaceRoot}/.jarvis/skills`);
  const injection = buildSkillInjection(skills);
  const system = `${agent.systemPrompt}${injection}`;
  const { input, block } = attachMentions(prompt, workspaceRoot, db, agentId);
  return buildContextMessages(ctx, system, [{ role: 'user', content: `${input}${block}` }]);
}

// J5 base: audit trail for approval decisions (and other lifecycle events).
export function appendAudit(db: Database.Database, e: { agentId: string | null; kind: string; detail: unknown }): void {
  db.prepare('INSERT INTO audit_logs (id, agent_id, kind, detail_json, created_at) VALUES (?,?,?,?,?)')
    .run(randomUUID(), e.agentId, e.kind, JSON.stringify(e.detail), new Date().toISOString());
}
