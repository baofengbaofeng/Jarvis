import type { BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { IpcEvent } from '@jarvis/protocol';
import { AgentEngine, ToolRegistry, TaskOrchestrator, createAdapter, buildContextMessages, buildPassedContext, buildTaskNotification, mergeEnv, createChatService, createFileTools, createShellTool, createGitTools, registerRunTestsTool, registerSearchCodeTool, registerDelegateTool, createGuard, createApprovalGate, DelegateGuardError, scanSkillsDir, buildSkillInjection, restoreSnapshot, parseMentions, resolveFileMention, buildMentionBlock, isPlanBlocked, planVisibleTools, IndexStore, hashEmbedding, resumeSession, MemoryStore, buildMemoryInjection, registerMemoryTools, captureArtifacts, type DelegateGuardState, type SessionStoreAdapter, type SessionMessage, type Squad, type SquadRouterDeps } from '@jarvis/core';
import { registerAgentMcpTools } from './mcp';
import { createArtifactsIpc } from './artifacts';
import { createMemoryAdapter } from './memory';
import { sqliteAuditSink } from '../audit/sqliteAuditSink';
import type { EngineChatFn, SandboxPolicy, Usage, ContextAttachment } from '@jarvis/core';
import { createAgentStore } from './agents';
import { createChatDbAdapter } from './chat';
import { createWorkspaceService } from './workspace';
import type { SettingsStore } from './settings';
import { webSearch } from './search';
import { getMessageBus } from './squad';
import { ApprovalCenter } from '../approval/ApprovalCenter';
import type { SecureStorage } from '../secrets/SecureStorage';
import type { UsageTracker } from '../usage/UsageTracker';
import type { AgentConfig } from '@jarvis/protocol';
import { createSnapshotStore, snapshotBeforeTask, createSnapshotGit, createSnapshotFs, createCodeIndexAdapter } from './coding';

// In-memory per-task log buffer. Streaming to the renderer is the sole
// responsibility of the orchestrator's cb.onLog (IpcEvent.taskLog), so task
// deltas are emitted exactly once; this buffer preserves them for later reads.
const taskLogs = new Map<string, string[]>();

// The engine is SHARED across tasks while TaskOrchestrator runs tasks
// concurrently (concurrency 6). The approval gate therefore must never rely on
// module-level state: M4 final review (finding 1) found that a module-level
// currentAgentId/currentPlanOnly set by tasks.create races when a plan-only
// task and an edit-mode task overlap — the gate read whichever task submitted
// last. Instead, the engine passes the RUN's agent through ApprovalRequest.agent
// (see AgentEngine.run), so plan-only blocking (E10), the mcp_grants consult
// (J2), and the audit rows are scoped to the agent that actually issued the
// tool call. No module-level agent identity exists here anymore.

export interface TaskHandlerDeps {
  chatFn?: EngineChatFn;
  maxSteps?: number;
  // M3 Task 9 (C6/J6): settings store used to resolve the per-agent sandbox
  // policy saved by the PermissionsSettingsPage. Falls back to the default
  // readwrite policy when absent.
  settings?: SettingsStore;
  // M8 Task 2 (B9): optional token-usage sink. Best-effort telemetry — when
  // absent (most specs), task completion just skips tracking.
  usageTracker?: UsageTracker;
}

export function registerTaskHandlers(db: Database.Database, secrets: SecureStorage, getWindow: () => BrowserWindow | null, agentStore = createAgentStore(db), deps: TaskHandlerDeps = {}) {
  const workspace = createWorkspaceService(db);
  // M6 Task 3 (F8/F9): shared per-agent run resolution. Both the direct task
  // path (create) and the squad member path (delegate_agent / runSquad) resolve
  // the agent's model binding, env, sandbox policy and workspace root the same
  // way, then run through the SAME shared engine — safe because the M4 fix
  // scoped the approval gate per-run via input.agent, not module-level state.
  const resolveAgentRun = async (agentId: string, prompt: string) => {
    const agent = agentStore.get(agentId);
    const ctx = workspace.loadContext(agentId);
    const workspaceRoot = agent.workspaceId ?? '.';
    const messages = buildTaskMessages(ctx, agent, prompt, workspaceRoot, db, agent.id, memory);
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
    return { agent, messages, env, apiKey, provider: { type: modelRow.type, baseUrl: modelRow.base_url }, modelId: modelRow.model_id, workspaceRoot, policy };
  };
  const chatService = createChatService(createChatDbAdapter(db));
  // Map task id -> chat session id so task completion can persist the assistant
  // turn into the same session that launched it (M1 session list + reload stays
  // working while M2 executes the task through the task path).
  const taskSessions = new Map<string, string>();
  // M8 Task 2 (B9): task id -> resolved run identity (agent + model) captured at
  // create time, so the completion path can attribute token usage even though
  // the orchestrator's onDone only carries (id, ok, text, usage).
  const taskRuns = new Map<string, { agentId: string; modelId: string }>();

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
  // M8 Task 3 (J5): persistent execution-audit sink over the audit_logs table
  // (migration v11). The onExec hook maps every tool execution (ok/error) into
  // the sink; approval-gate denials write a 'denied' entry directly below
  // (ToolRegistry has no sandbox/permission concept, so execute() can never emit
  // 'denied' itself — the gate is the single source of that result).
  const auditSink = sqliteAuditSink(db);
  // K6 (M8 Task 10): in-process artifact store over the task_artifacts table
  // (migration v12). The onDone completion path captures the final result text
  // (tables/mermaid/markdown) and saves each artifact here; the renderer reads
  // them back via the artifacts.list IPC channel (see IpcRouter). db is in
  // scope, so the SAME createArtifactsIpc the router uses is constructed
  // inline — no extra wiring through TaskHandlerDeps needed.
  const artifacts = createArtifactsIpc(db);
  const toolRegistry = new ToolRegistry({ onExec: (e) => auditSink.write({ ts: new Date(e.ts).toISOString(), kind: 'tool_call', actor: 'agent', action: e.tool, target: String(e.args).slice(0, 200), result: e.result }) });
  // F11: one shared MemoryStore over the main-owned agent_memory table (the
  // adapter is keyed by agent_id, so a single store serves every agent). The
  // per-run <memory> injection (buildTaskMessages) is where an agent's persisted
  // memories actually reach the model; the memorize/recall tools are registered
  // per-run below (see registerMemoryToolsFor).
  const memory = new MemoryStore(createMemoryAdapter(db));
  // F11: register the shared memorize/recall tools for THIS run's agent. The
  // engine tool registry is SHARED across concurrently running tasks
  // (TaskOrchestrator concurrency 6) and the handlers bake the agentId at
  // registration, so when two agents run concurrently the LAST registration wins
  // for both — a documented single-active limitation (same precedent as the
  // squadCtx guard, M6 Task 3). The per-run <memory> system-prompt injection
  // (buildTaskMessages above) is the PRIMARY F11 value and stays correct for
  // every run; the tools are best-effort until M7 threads a per-run agent
  // resolver into ToolContext.
  const registerMemoryToolsFor = (agentId: string): void => registerMemoryTools(toolRegistry, memory, agentId);
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
  // M4 Task 6 (E1/L27): search_code tool. Backed by the SAME code_chunks table
  // as the index.reindex IPC, so it searches whichever workspace was last
  // reindexed (single-active-index assumption, documented). embeddingFn defaults
  // to the deterministic local hashEmbedding; production Provider embedding (M1
  // ModelRouter extension) is a later swap at construction.
  registerSearchCodeTool(toolRegistry, new IndexStore(createCodeIndexAdapter(db), hashEmbedding));
  // M5 Task 10 (L25): web_search routes through settings.search_providers (the
  // SearchProvidersPage form) and falls back to the M1 legacy implementation.
  // The tool is a thin adapter over the main-side webSearch helper — fetch and
  // parse live in main; the model only sees the ranked text. deps.settings may
  // be absent in tests, so fall back to an empty store that yields
  // "not configured" (a clear { ok:false } instead of a throw).
  const searchSettings = deps.settings ?? { get: () => undefined, set: () => {}, getAll: () => ({}) };
  toolRegistry.register({
    name: 'web_search',
    description: 'Search the web and return ranked results with title, url and snippet',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  }, async (args) => {
    try {
      const results = await webSearch(searchSettings, String(args.query ?? ''));
      return { ok: true, output: results.map(r => `${r.title}\n${r.url}\n${r.snippet}`).join('\n---\n') || 'no results' };
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) };
    }
  });
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
      // req.agent is the RUN's agent (the engine passes it through per tool
      // call), so concurrent plan-only and edit-mode tasks cannot leak into
      // each other's gate. (M4 review finding 1)
      if (req.agent.planOnly && isPlanBlocked(req.toolName)) {
        appendAudit(db, { agentId: req.agent.id, kind: 'approval', detail: { toolName: req.toolName, ok: false, reason: 'plan_only_blocked' } });
        // J5: the gate is where a denial is decided — ToolRegistry.execute has
        // no permission concept, so the 'denied' audit entry is emitted here.
        auditSink.write({ ts: new Date().toISOString(), kind: 'tool_call', actor: 'agent', action: req.toolName, target: String(req.args).slice(0, 200), result: 'denied' });
        return false;
      }
      // G8: previously-approved mcp:{server}:{tool} calls are auto-allowed by
      // folding the grants rows into allowAlways (granted=1 rows). M3 final
      // review (J2): grants are consulted per-agent (the run's agent id),
      // falling back to server-wide rows (agent_id = '') so grants written
      // before per-agent scoping still auto-allow.
      const grants = db.prepare('SELECT server_id, tool_name FROM mcp_grants WHERE granted = 1 AND (agent_id = ? OR agent_id = ?)').all(req.agent.id, '') as Array<{ server_id: string; tool_name: string }>;
      const allowAlways = ['read_file', 'list_dir', ...grants.map(g => `mcp:${g.server_id}:${g.tool_name}`)];
      const decision = approvalGate.evaluate(req.toolName, req.args, { allowAlways, sensitiveCommands: [] });
      // M3 Task 7 gap fix: git_commit is a mutating git tool that the
      // ApprovalGate's shell-command regexes can never see (it has no
      // args.command), so force it through interactive approval.
      if (decision === 'allow' && req.toolName !== 'git_commit') return true;
      const ok = await approval.request(req);
      appendAudit(db, { agentId: req.agent.id, kind: 'approval', detail: { toolName: req.toolName, ok } });
      // J5: a denied approval is an execution-audit event — emit a 'denied'
      // tool_call entry alongside the 'approval' decision row above.
      if (!ok) {
        auditSink.write({ ts: new Date().toISOString(), kind: 'tool_call', actor: 'agent', action: req.toolName, target: String(req.args).slice(0, 200), result: 'denied' });
      }
      // G8/J7: a denied-then-approved mcp call writes a grant so the next call
      // hits allowAlways and skips approval. The grant is scoped to the run's
      // agent id (J2 per-agent isolation) rather than the old server-wide ''
      // sentinel, so another agent cannot inherit this approval.
      if (ok && req.toolName.startsWith('mcp:')) {
        const seg = req.toolName.slice('mcp:'.length).split(':');
        if (seg.length >= 2) {
          db.prepare('INSERT INTO mcp_grants (id, agent_id, server_id, tool_name, granted, created_at) VALUES (?,?,?,?,?,?)')
            .run(randomUUID(), req.agent.id, seg[0], seg.slice(1).join(':'), 1, new Date().toISOString());
        }
      }
      return ok;
    }
  });

  // M6 Task 3 (F8/F9): squad delegation + runner. The shared engine has no
  // per-run identity channel to tools (AgentEngine passes only args + ToolContext
  // to a tool handler), so the delegate_agent tool reads the CURRENT squad run
  // from squadCtx, set by runLeader before the leader's engine run and kept
  // alive through runSquad's member loop — so a member result the tool computed
  // inline during the leader run is reused instead of re-run. Squad runs are
  // single-active in this milestone (squad.start drives one leader at a time);
  // M7's Multica queue will own a proper per-run context.
  let squadCtx: { guard: DelegateGuardState; leaderAgentId: string; taskId: string; input: string; memberResults: Map<string, string>; memberActive: boolean } | null = null;

  // E14 isolation: each member runs with its OWN resolved config + workspace
  // root through the shared engine — the approval gate is per-run via
  // input.agent, so concurrent leader and member runs cannot leak into each
  // other (same rationale as the M4 approval-gate fix).
  const runMemberAgent = async (agentId: string, prompt: string): Promise<string> => {
    const run = await resolveAgentRun(agentId, prompt);
    await registerAgentMcpTools(db, toolRegistry, agentId);
    registerMemoryToolsFor(agentId);
    const result = await engine.run({ ...run, cwd: run.workspaceRoot });
    return result.text;
  };

  // L13 (M6 final review finding 1): the member's prompt is the leader's
  // delegation context PLUS the specific subtask. The context is the
  // strategy-processed leader input (buildPassedContext), so a 'summary' or
  // 'conclusion' member sees a truncated/processed view rather than the raw
  // leader input — the strategy actually reaches the member prompt now.
  const buildMemberPrompt = (subtask: string, context: string): string =>
    context ? `[Leader 指示]\n${context}\n\n[子任务]\n${subtask}` : subtask;

  // M6 Task 5 (L14): persist one delegation edge (leader -> member) when a
  // delegate_agent completes, so squad.graph can render the call chain. The
  // edge's squad_id is the ACTIVE squad row id (squadCtx.taskId IS the squad id
  // per prepare) — passed explicitly because squadCtx is a mutable closure let
  // and the call happens inside an async body. squad.graph queries by squad_id
  // because the delegation taskId here is the squad row id, not the squad's
  // bound task_id (a separate optional column). A graph-write failure must
  // NEVER fail the delegation: the bus messages are the run's source of truth,
  // the graph is derived telemetry.
  const recordCallEdge = (from: string, to: string, taskId: string, squadId: string | null, ok: boolean): void => {
    try {
      db.prepare('INSERT INTO agent_call_edges (id, from_agent, to_agent, task_id, squad_id, ok, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(randomUUID(), from, to, taskId, squadId, ok ? 1 : 0, new Date().toISOString());
    } catch { /* best-effort telemetry: a graph-write failure never breaks the delegation */ }
  };

  // The delegate_agent route: verify the delegation is within a live squad, run
  // the member inline (Multica SOP: members REACT and the result returns to the
  // leader), and persist the delegate/response/complete lifecycle on the bus
  // (L12). Throwing on an invalid delegation fails the leader's run loudly
  // rather than silently producing a bogus member result.
  const delegateRoute = async (to: string, subtask: string, from: string, taskId: string): Promise<string> => {
    if (!squadCtx) throw new Error('delegate_agent called outside a squad run');
    // Capture the context in a const so the async body keeps a stable reference
    // (squadCtx is a mutable closure let; narrowing does not survive awaits).
    const ctx = squadCtx;
    const squadRow = db.prepare('SELECT leader_agent_id, member_agent_ids_json FROM squads WHERE id = ?').get(taskId) as { leader_agent_id: string; member_agent_ids_json: string } | undefined;
    if (!squadRow || squadRow.leader_agent_id !== from) throw new Error(`agent ${from} is not a squad leader`);
    const members = JSON.parse(squadRow.member_agent_ids_json ?? '[]') as string[];
    if (!members.includes(to)) throw new Error(`agent ${to} is not a member of squad ${taskId}`);
    const bus = getMessageBus();
    bus.post({ kind: 'delegate', from, to, taskId, payload: { subtask } });
    ctx.memberActive = true;
    try {
      // L13 (M6 final review finding 1): the leader's input was stashed on
      // squadCtx by runLeader; process it through the MEMBER's configured
      // context_passing strategy and build the member prompt so the strategy
      // reaches the actual member run. Previously the context was computed only
      // in runSquad's member loop and discarded on the cached path — the member
      // ran on the bare subtask and full/summary/conclusion/custom had no effect.
      const member = agentStore.get(to);
      const processed = await buildPassedContext(member.contextPassing ?? 'full', ctx.input);
      const text = await runMemberAgent(to, buildMemberPrompt(subtask, processed));
      ctx.memberResults.set(to, text);
      bus.post({ kind: 'response', from: to, to: from, taskId, payload: { text } });
      bus.post({ kind: 'complete', from: to, to: from, taskId, payload: { ok: true } });
      // L14: record the successful leader->member call edge.
      recordCallEdge(from, to, taskId, ctx.taskId, true);
      return text;
    } catch (e) {
      bus.post({ kind: 'complete', from: to, to: from, taskId, payload: { ok: false, error: e instanceof Error ? e.message : String(e) } });
      // L14: record the failed leader->member call edge too (label 'failed').
      recordCallEdge(from, to, taskId, ctx.taskId, false);
      throw e;
    } finally {
      ctx.memberActive = false;
    }
  };

  // Task 2's registerDelegateTool binds fromAgent/guard statically; the getters
  // read the CURRENT squad run so the one shared tool serves whichever leader is
  // running. Non-leader task runs never touch squadCtx (route rejects them).
  registerDelegateTool(toolRegistry, {
    get guard() { return squadCtx?.guard ?? createGuard(); },
    // Members are leaves (Multica SOP). Throwing HERE blocks a member-initiated
    // delegate_agent BEFORE any guard depth is attributed to the leader — a
    // recursive member call fails loudly with a clear DelegateGuardError instead
    // of being credited to the leader and passing the cycle guard. Otherwise
    // resolve the RUN's agent (ctx.agent, threaded through AgentEngine.run) so a
    // shared registry attributes the delegation to whoever actually issued it,
    // falling back to the active squad leader (M6 final review finding 3).
    fromAgent: (ctx) => {
      if (squadCtx?.memberActive) throw new DelegateGuardError('members cannot delegate');
      return ctx.agent?.id ?? squadCtx?.leaderAgentId ?? '';
    },
    // L15 (M6 final review finding 2): hash the SUBTASK (not the constant squad
    // id) so a leader delegating two DIFFERENT subtasks to the same member gets
    // distinct guard keys instead of a spurious 'delegation cycle detected'.
    taskHash: (subtask) => squadCtx ? `${squadCtx.taskId}:${subtask}` : subtask,
    taskId: () => squadCtx?.taskId ?? '',
    route: delegateRoute
  });

  // SquadRunner (consumed by squad.start in ./squad): runLeader runs the leader
  // engine and collects the delegate_agent calls it makes as delegations;
  // runMember returns the inline member result when the tool already computed it
  // (avoiding a double member run), else runs the member fresh.
  const squadRunner: SquadRouterDeps & { prepare(squad: Squad): void; teardown(): void; isActive(): boolean; runAgentOnce(agentId: string, input: string): Promise<string> } = {
    prepare(squad: Squad): void {
      squadCtx = { guard: createGuard(), leaderAgentId: squad.leaderAgentId, taskId: squad.id, input: '', memberResults: new Map(), memberActive: false };
    },
    teardown(): void { squadCtx = null; },
    // Single-active guard used by squad.start: reject a second concurrent run
    // before it can overwrite squadCtx and corrupt the first run.
    isActive(): boolean { return squadCtx !== null; },
    async runLeader(input: string): Promise<{ text: string; delegations: Array<{ to: string; subtask: string }> }> {
      if (!squadCtx) throw new Error('squad runner used without prepare');
      // L13 (M6 final review finding 1): stash the leader's task input on the
      // squad context so delegateRoute can shape it per-member via the member's
      // context_passing strategy at delegate time (the strategy output must reach
      // the member prompt, not be discarded after runLeader returns).
      squadCtx.input = input;
      const leader = await resolveAgentRun(squadCtx.leaderAgentId, input);
      await registerAgentMcpTools(db, toolRegistry, squadCtx.leaderAgentId);
      registerMemoryToolsFor(squadCtx.leaderAgentId);
      const delegations: Array<{ to: string; subtask: string }> = [];
      const result = await engine.run({
        ...leader, cwd: leader.workspaceRoot,
        onTool: (call) => {
          if (call.name === 'delegate_agent') {
            delegations.push({ to: String(call.arguments.agent), subtask: String(call.arguments.subtask) });
          }
        }
      });
      return { text: result.text, delegations };
    },
    async runMember(agentId: string, subtask: string, context: string): Promise<string> {
      const cached = squadCtx?.memberResults.get(agentId);
      if (cached !== undefined) return cached;
      // Uncached path (a delegation not actually run inline during the leader
      // run): still hand the member the composed context — L13 must apply
      // whether the member ran at delegate time or here.
      return runMemberAgent(agentId, buildMemberPrompt(subtask, context));
    },
    // M6 Task 6 (F10): a workflow node is a single agent run through the SAME
    // shared engine as a squad member — resolveAgentRun -> engine.run, no squad
    // context involved. runMemberAgent is exactly this, so reuse it rather than
    // duplicating the resolution. Same per-run isolation (input.agent on the
    // approval gate), so concurrent workflow nodes cannot leak into each other.
    async runAgentOnce(agentId: string, input: string): Promise<string> {
      return runMemberAgent(agentId, input);
    },
    // L13: the RECEIVING member's context_passing strategy shapes the leader's
    // delegation context (runSquad passes d.to). Resolving by memberId instead
    // of the brief's single `agent` is intentional — "按 agent 配置" reads most
    // naturally as each member controlling what IT is handed; a shared leader
    // strategy would flatten every member to one shape.
    buildContext: async (memberId: string, result: string): Promise<string> => {
      const member = agentStore.get(memberId);
      return buildPassedContext(member.contextPassing ?? 'full', result);
    },
    summarize: async (members: Array<{ agent: string; result: string }>): Promise<string> => members.map(m => m.result).join('\n')
  };

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
    onLog: (id, line) => {
      getWindow()?.webContents.send(IpcEvent.taskLog, { id, line });
      // K5 (M6 Task 10): during a squad run, stream the task log line onto the
      // squad timeline too ('squad:event'). The leader/member engine runs
      // (runLeader/runMember) go through engine.run directly and never reach
      // the orchestrator today, so this fires only for direct tasks — a no-op
      // guard keeps non-squad logs off the squad timeline and future-proofs the
      // push when M7 threads squad member logs through the orchestrator.
      if (squadCtx) getWindow()?.webContents.send(IpcEvent.squadEvent, { agent: squadCtx.leaderAgentId, ts: Date.now(), kind: 'log', detail: line });
    },
    onDone: (id, ok, text, usage) => {
      db.prepare('UPDATE tasks SET status = ?, result_json = ?, completed_at = ? WHERE id = ?').run(ok ? 'completed' : 'failed', JSON.stringify({ text }), new Date().toISOString(), id);
      getWindow()?.webContents.send(ok ? IpcEvent.taskComplete : IpcEvent.taskFailed, { id, text });
      const sessionId = taskSessions.get(id);
      if (sessionId) void chatService.appendMessage(sessionId, 'assistant', text);
      // M8 Task 2 (B9): best-effort token telemetry. Only the completion path
      // carries usage; the failure path leaves it undefined and is skipped. A
      // missing taskRuns entry (unlikely) degrades to NULL agent/model ids.
      if (usage) {
        const run = taskRuns.get(id);
        deps.usageTracker?.track({ taskId: id, agentId: run?.agentId, modelId: run?.modelId, ...usage });
      }
      // M8 final review: a task run is single-shot — release its resolved run
      // identity so the map cannot grow unbounded across many tasks.
      taskRuns.delete(id);
      // K6 (M8 Task 10): capture markdown tables / ```mermaid blocks from the
      // final result into task_artifacts so the /canvas view can render them.
      // Best-effort with the SAME contract as the token telemetry above: a
      // capture/save failure must NEVER break task completion. Empty/failed
      // results degrade per captureArtifacts — [] for empty text, a single
      // markdown artifact for prose.
      try {
        for (const a of captureArtifacts(id, text)) artifacts.save(null, a);
      } catch { /* best-effort artifact capture */ }
      // M6 Task 8 (I5): a terminal task outcome fires a desktop notification
      // plus an in-app toast. buildTaskNotification is the unit-tested decision
      // logic (complete/failed only). NotificationBridge is lazy-imported so
      // Node specs never load 'electron' at import time, and the bridge itself
      // is a guarded no-op there. Tasks have no title column, so the body is a
      // truncated representation of the terminal result text.
      const d = buildTaskNotification(ok ? 'complete' : 'failed', { title: summarizeForNotification(text) });
      if (d.notify) {
        void import('../notify/NotificationBridge').then(({ showSystemNotification }) => showSystemNotification(d.title, d.body)).catch(() => {});
        getWindow()?.webContents.send(IpcEvent.toastPush, { kind: ok ? 'success' : 'error', message: d.body });
      }
    }
  }, 6);

  return {
    approvalCenter: approval,
    // M6 Task 3 (F8/F9): squad runner handed to the squad IPC (./squad) so
    // squad.start can orchestrate the leader/member engine runs through the
    // SAME shared engine and per-agent resolution as the direct task path.
    squad: squadRunner,
    async create(_event: Electron.IpcMainInvokeEvent, args: { agentId: string; prompt: string; sessionId?: string }) {
      const { agentId, prompt, sessionId } = args;
      const id = randomUUID();
      // M4 review (finding 1): the agent's identity flows to the shared engine's
      // approval gate through ApprovalRequest.agent (set per tool call in
      // AgentEngine.run) — no module-level currentAgentId/currentPlanOnly.
      const { agent, messages, env, apiKey, provider, modelId, workspaceRoot, policy } = await resolveAgentRun(agentId, prompt);
      await store.create(id, agentId);
      taskRuns.set(id, { agentId, modelId });
      // G6: register the agent's bound MCP servers' tools into the shared
      // engine registry (filtered by config_json.agentIds). Clients are cached
      // per server id (see ./mcp) so repeated task runs reuse the same child
      // process instead of leaking one per run; failures are logged and skipped
      // so a bad server never blocks task creation.
      await registerAgentMcpTools(db, toolRegistry, agentId);
      registerMemoryToolsFor(agentId);
      // E10 (plan mode): expose only the plan-safe tool subset to the model.
      // The approval gate above re-blocks the same tools at execution time; the
      // visible set is stored on the engine for the upcoming tools-field wiring
      // (ChatRequest.tools lands with the real-provider REACT rework).
      engine.setVisibleTools(planVisibleTools(toolRegistry.list().map(t => t.name), agent.planOnly));
      if (sessionId) {
        taskSessions.set(id, sessionId);
        await chatService.appendMessage(sessionId, 'user', prompt);
        // E15: persist the task -> session link in payload_json so task.resume
        // can rebuild context even after the in-memory taskSessions map is gone
        // (e.g. the app was restarted since the task ran).
        db.prepare('UPDATE tasks SET payload_json = ? WHERE id = ?').run(JSON.stringify({ sessionId }), id);
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
      orchestrator.submit({ id, agent, messages, cwd: agent.workspaceId ?? '.', env, apiKey, provider, modelId, workspaceRoot, policy });
      return { id };
    },
    cancel: (_e: unknown, id: string) => orchestrator.cancel(id),
    pause: (_e: unknown, id: string) => orchestrator.pause(id),
    // M4 Task 8 (E15): resume-with-context. A PAUSED task resumes through the
    // in-memory orchestrator (existing behavior). A finished/interrupted task
    // rebuilds its engine context from the chat history via resumeSession and
    // returns the resumed SessionMessage[] for the caller to continue from.
    // The engine re-run (submitting those messages back into AgentEngine.run)
    // is the documented remaining step — the plumbing to obtain the resumed
    // context is fully wired here.
    resume: async (_e: unknown, id: string) => {
      const row = db.prepare('SELECT status, agent_id, payload_json FROM tasks WHERE id = ?').get(id) as { status: string; agent_id: string; payload_json: string } | undefined;
      if (!row) throw new Error(`task not found: ${id}`);
      if (row.status === 'paused') { orchestrator.resume(id); return { ok: true, resumed: 'paused' }; }
      const sessionId = taskSessions.get(id) ?? ((JSON.parse(row.payload_json ?? '{}') as { sessionId?: string }).sessionId);
      if (!sessionId) throw new Error(`no chat session for task ${id}`);
      const agent = agentStore.get(row.agent_id);
      const messages = await resumeSession(createTaskSessionAdapter(db, sessionId), id, agent.contextBudgetTokens, async (dropped) => {
        const text = dropped.map(m => `${m.role}: ${m.content}`).join('\n');
        return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
      });
      return { ok: true, resumed: 'context', messages };
    },
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

// I5 (M6 Task 8): the tasks table has no title column, so a task notification
// body is a truncated representation of the terminal result text — the first
// non-empty line, capped at 120 chars (the same text the renderer already
// surfaces on task:complete / task:failed).
function summarizeForNotification(text: string): string {
  const line = text.trim().split('\n').find(l => l.trim().length > 0) ?? '';
  const trimmed = line.trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed;
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
      refs.push(resolveFileMention(m.query, wsRoot, readImpl, { resolve, relative, isAbsolute }));
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

function buildTaskMessages(ctx: { jarvisMd: string; agentMd: string | null }, agent: AgentConfig, prompt: string, workspaceRoot: string, db: Database.Database, agentId: string | null, memory: MemoryStore): Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }> {
  const skills = scanSkillsDir(`${workspaceRoot}/.jarvis/skills`);
  const injection = buildSkillInjection(skills);
  // F11: every run starts with THIS agent's persisted memories appended to the
  // system prompt. Built fresh per resolveAgentRun, so concurrent runs of
  // different agents each see their own <memory> block (the injection is the
  // primary F11 value and is per-run correct even where the memorize/recall
  // tools are single-active).
  const memoryBlock = agentId ? buildMemoryInjection(memory.recall(agentId)) : '';
  const system = `${agent.systemPrompt}${injection}${memoryBlock}`;
  const { input, block } = attachMentions(prompt, workspaceRoot, db, agentId);
  return buildContextMessages(ctx, system, [{ role: 'user', content: `${input}${block}` }]);
}

// M4 Task 8 (E15): SessionStoreAdapter over the chat_messages table. History is
// the session's user/assistant turns; summaries are persisted as specially
// marked system messages so resumeSession can reuse them across restarts
// without a schema change (the task -> session link is in tasks.payload_json).
const SUMMARY_MARKER = '[JARVIS_SUMMARY]';

function createTaskSessionAdapter(db: Database.Database, sessionId: string): SessionStoreAdapter {
  return {
    async getMessages(): Promise<SessionMessage[]> {
      const rows = db.prepare('SELECT role, content FROM chat_messages WHERE session_id = ? AND role IN (?,?) ORDER BY created_at').all(sessionId, 'user', 'assistant') as Array<{ role: 'user' | 'assistant'; content: string }>;
      return rows.filter(r => !r.content.startsWith(SUMMARY_MARKER));
    },
    async getSummary(): Promise<string | null> {
      const row = db.prepare('SELECT content FROM chat_messages WHERE session_id = ? AND role = ? AND content LIKE ? ORDER BY created_at DESC LIMIT 1').get(sessionId, 'system', `${SUMMARY_MARKER}%`) as { content: string } | undefined;
      return row ? row.content.slice(SUMMARY_MARKER.length) : null;
    },
    async saveSummary(_taskId: string, text: string): Promise<void> {
      db.prepare('INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)').run(randomUUID(), sessionId, 'system', `${SUMMARY_MARKER}${text}`, new Date().toISOString());
    }
  };
}

// J5 base: audit trail for approval decisions (and other lifecycle events).
// Migration v11 reshaped audit_logs from the v1 vestigial columns (id TEXT,
// agent_id, detail_json, created_at) to the execution-audit shape
// (kind, actor, action, target, result, detail, task_id, ts) — so this INSERT
// maps the old fields onto the new columns: kind stays, actor=agentId,
// action=toolName (or the kind), target=query, result is derived from the
// detail (mention failures are 'error', denials 'denied', everything else
// 'ok'), and detail keeps the full JSON payload.
export function appendAudit(db: Database.Database, e: { agentId: string | null; kind: string; detail: unknown }): void {
  const d = (e.detail ?? {}) as { toolName?: string; ok?: boolean; reason?: string; query?: string };
  const action = d.toolName ?? e.kind;
  const target = d.query ?? null;
  const result = e.kind === 'mention' ? 'error' : (d.ok === false || d.reason ? 'denied' : 'ok');
  db.prepare('INSERT INTO audit_logs (kind, actor, action, target, result, detail) VALUES (?,?,?,?,?,?)')
    .run(e.kind, e.agentId, action, target, result, JSON.stringify(e.detail));
}
