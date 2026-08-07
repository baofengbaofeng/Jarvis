import type { BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { IpcEvent } from '@jarvis/protocol';
import {
  TaskOrchestrator,
  mergeEnv,
  createChatService,
  buildTaskNotification,
  planVisibleTools,
  restoreSnapshot,
  resumeSession,
  captureArtifacts,
} from '@jarvis/core';
import { registerAgentMcpTools } from './mcp';
import { createArtifactsIpc } from './artifacts';
import type { SandboxPolicy } from '@jarvis/core';
import { createAgentStore } from './agents';
import { createChatDbAdapter } from './chat';
import { createWorkspaceService } from './workspace';
import type { SettingsStore } from './settings';
import type { SecureStorage } from '../secrets/SecureStorage';
import type { UsageTracker } from '../usage/UsageTracker';
import { createSnapshotStore, snapshotBeforeTask, createSnapshotGit, createSnapshotFs } from './coding';
import { createTaskEngineRuntime } from './task-engine-factory';
import { createSquadRunner } from './task-squad-bridge';
import { buildTaskMessages, createTaskSessionAdapter, summarizeForNotification } from './task-messages';

const taskLogs = new Map<string, string[]>();
const MAX_TASK_LOG_LINES = 500;

// ARCH-01 (§13.3 writer ownership): the design doc assigns `tasks` to the Go
// daemon, but 1.0.0-Preview routes all task CRUD through Electron main for a single
// user-facing path. The daemon only schedules Multica-claimed work; main and
// daemon must not UPDATE the same task row concurrently.

export interface TaskHandlerDeps {
  chatFn?: import('@jarvis/core').EngineChatFn;
  maxSteps?: number;
  settings?: SettingsStore;
  usageTracker?: UsageTracker;
  /** CORE-04: shared ModelRouter with the chat path. */
  router?: import('@jarvis/core').ModelRouter;
}

export { appendAudit } from './task-messages';

export function registerTaskHandlers(db: Database.Database, secrets: SecureStorage, getWindow: () => BrowserWindow | null, agentStore = createAgentStore(db), deps: TaskHandlerDeps = {}) {
  const workspace = createWorkspaceService(db);
  const { engine, toolRegistry, approval, memory, registerMemoryToolsFor } = createTaskEngineRuntime(db, getWindow, deps);

  const resolveAgentRun = async (agentId: string, prompt: string) => {
    const agent = agentStore.get(agentId);
    const ctx = workspace.loadContext(agentId);
    const workspaceRoot = agent.workspaceId ?? '.';
    const messages = buildTaskMessages(ctx, agent, prompt, workspaceRoot, db, agent.id, memory);
    const modelRow = db.prepare('SELECT m.model_id, p.base_url, p.type, p.api_key_ref FROM models m JOIN providers p ON p.id = m.provider_id WHERE m.id = ?').get(agent.modelId) as { model_id: string; base_url: string; type: 'openai-compatible' | 'anthropic-compatible'; api_key_ref: string } | undefined;
    if (!modelRow) throw new Error('agent has no valid model binding');
    const apiKey = await secrets.get(modelRow.api_key_ref);
    if (!apiKey) throw new Error('missing api key');
    const agentRow = db.prepare('SELECT env_vars_json FROM agents WHERE id = ?').get(agentId) as { env_vars_json: string } | undefined;
    const agentEnv = agentRow ? (JSON.parse(agentRow.env_vars_json ?? '{}') as Record<string, string>) : {};
    const env = mergeEnv({}, {}, agentEnv, {});
    const savedPolicy = deps.settings?.get(`permissions.${agentId}`) as { level?: 'readonly' | 'readwrite' | 'system'; allowCommands?: string[]; allowDomains?: string[] } | undefined;
    const policy: SandboxPolicy = {
      level: savedPolicy?.level ?? 'readwrite',
      allowCommands: savedPolicy?.allowCommands ?? [],
      allowDomains: savedPolicy?.allowDomains ?? []
    };
    return { agent, messages, env, apiKey, provider: { type: modelRow.type, baseUrl: modelRow.base_url }, modelId: modelRow.model_id, workspaceRoot, policy };
  };

  const chatService = createChatService(createChatDbAdapter(db));
  const taskSessions = new Map<string, string>();
  const taskRuns = new Map<string, { agentId: string; modelId: string }>();
  const artifacts = createArtifactsIpc(db);

  const squadRunner = createSquadRunner({
    db,
    agentStore,
    engine,
    toolRegistry,
    resolveAgentRun,
    registerMemoryToolsFor,
  });

  const store = {
    async create(id: string, agentId: string) {
      db.prepare('INSERT INTO tasks (id, agent_id, status, payload_json, created_at) VALUES (?,?,?,?,?)').run(id, agentId, 'queued', '{}', new Date().toISOString());
    },
    async updateState(id: string, state: string) { db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(state, id); },
    async appendLog(id: string, line: string) {
      const buf = taskLogs.get(id) ?? [];
      buf.push(line);
      if (buf.length > MAX_TASK_LOG_LINES) buf.splice(0, buf.length - MAX_TASK_LOG_LINES);
      taskLogs.set(id, buf);
    }
  };

  const snapshotStore = createSnapshotStore(db);

  const orchestrator = new TaskOrchestrator(engine, store, {
    onStateChange: (id, state) => { getWindow()?.webContents.send(IpcEvent.taskState, { id, state }); },
    onLog: (id, line) => {
      getWindow()?.webContents.send(IpcEvent.taskLog, { id, line });
      const leaderId = squadRunner.getActiveLeaderId();
      if (leaderId) getWindow()?.webContents.send(IpcEvent.squadEvent, { agent: leaderId, ts: Date.now(), kind: 'log', detail: line });
    },
    onTool: (id, call, result) => {
      const sessionId = taskSessions.get(id);
      if (!sessionId) return;
      getWindow()?.webContents.send(IpcEvent.chatDelta, {
        sessionId,
        chunk: {
          kind: 'tool_done',
          name: call.name,
          ok: result.ok,
          output: result.output,
          arguments: call.arguments,
        },
      });
    },
    onDone: (id, ok, text, usage) => {
      db.prepare('UPDATE tasks SET status = ?, result_json = ?, completed_at = ? WHERE id = ?').run(ok ? 'completed' : 'failed', JSON.stringify({ text }), new Date().toISOString(), id);
      getWindow()?.webContents.send(ok ? IpcEvent.taskComplete : IpcEvent.taskFailed, { id, text });
      const sessionId = taskSessions.get(id);
      if (sessionId) void chatService.appendMessage(sessionId, 'assistant', text);
      if (usage) {
        const run = taskRuns.get(id);
        deps.usageTracker?.track({ taskId: id, agentId: run?.agentId, modelId: run?.modelId, ...usage });
      }
      taskRuns.delete(id);
      try {
        for (const a of captureArtifacts(id, text)) artifacts.save(null, a);
      } catch { /* best-effort */ }
      const d = buildTaskNotification(ok ? 'complete' : 'failed', { title: summarizeForNotification(text) });
      if (d.notify) {
        void import('../notify/NotificationBridge').then(({ showSystemNotification }) => showSystemNotification(d.title, d.body)).catch(() => {});
        getWindow()?.webContents.send(IpcEvent.toastPush, { kind: ok ? 'success' : 'error', message: d.body });
      }
    }
  }, 6);

  return {
    approvalCenter: approval,
    squad: squadRunner,
    async create(_event: Electron.IpcMainInvokeEvent, args: { agentId: string; prompt: string; sessionId?: string }) {
      const { agentId, prompt, sessionId } = args;
      const id = randomUUID();
      const { agent, messages, env, apiKey, provider, modelId, workspaceRoot, policy } = await resolveAgentRun(agentId, prompt);
      await store.create(id, agentId);
      taskRuns.set(id, { agentId, modelId });
      await registerAgentMcpTools(db, toolRegistry, agentId);
      registerMemoryToolsFor(agentId);
      engine.setVisibleTools(planVisibleTools(toolRegistry.list().map(t => t.name), agent.planOnly));
      if (sessionId) {
        taskSessions.set(id, sessionId);
        await chatService.appendMessage(sessionId, 'user', prompt);
        db.prepare('UPDATE tasks SET payload_json = ? WHERE id = ?').run(JSON.stringify({ sessionId }), id);
      }
      if (agent.workspaceId) {
        await snapshotBeforeTask(agent.workspaceId, id, snapshotStore);
      }
      orchestrator.submit({ id, agent, messages, cwd: agent.workspaceId ?? '.', env, apiKey, provider, modelId, workspaceRoot, policy });
      return { id };
    },
    cancel: (_e: unknown, id: string) => orchestrator.cancel(id),
    pause: (_e: unknown, id: string) => orchestrator.pause(id),
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
    async rollback(_e: unknown, id: string) {
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as { agent_id: string } | undefined;
      if (!task) throw new Error(`task not found: ${id}`);
      const agent = agentStore.get(task.agent_id);
      const wsRoot = agent.workspaceId;
      if (!wsRoot) throw new Error(`agent ${agent.id} has no bound workspace; cannot roll back task ${id}`);
      await restoreSnapshot({ taskId: id, workspaceRoot: wsRoot, git: createSnapshotGit(), fs: createSnapshotFs(), store: snapshotStore });
      db.prepare('UPDATE tasks SET status = ?, result_json = ? WHERE id = ?').run('failed', JSON.stringify({ reason: 'rolled_back' }), id);
      getWindow()?.webContents.send(IpcEvent.taskState, { id, state: 'failed' });
      return { ok: true };
    }
  };
}
