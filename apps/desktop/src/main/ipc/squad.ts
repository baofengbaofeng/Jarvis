import type Database from 'better-sqlite3';
import type { BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { MessageBus, CallGraph, createSquad, detectCycle, squadTransition, runSquad, runWorkflow, type Squad, type SquadEvent, type SquadRouterDeps, type SquadStatus, type Workflow } from '@jarvis/core';
import { IpcEvent } from '@jarvis/protocol';

// The bus is a module-level singleton: every M6 squad feature (task
// orchestrator, delegation, external agents) shares ONE in-memory routing
// fabric (L12, §13.3). Main owns persistence — see createBusPersist.
let bus: MessageBus | null = null;
export function getMessageBus(): MessageBus {
  if (!bus) bus = new MessageBus();
  return bus;
}

// Test-only teardown: discards the cached singleton so specs start each test
// with a fresh bus and never accumulate persist subscriptions across tests
// (IpcRouter.registerAll subscribes this singleton; see IpcRouter.spec).
export function __resetBusForTests(): void { bus = null; }

// Subscribes the bus to the main-owned agent_messages table so EVERY posted
// message is durable. Returns the unsubscribe handle. Column names must match
// migration v4 (id, kind, from_agent, to_agent, task_id, payload_json,
// created_at).
export function createBusPersist(db: Database.Database, bus: MessageBus): () => void {
  const ins = db.prepare('INSERT INTO agent_messages (id, kind, from_agent, to_agent, task_id, payload_json, created_at) VALUES (?,?,?,?,?,?,?)');
  return bus.subscribe(m => {
    ins.run(m.id, m.kind, m.from, m.to, m.taskId ?? null, JSON.stringify(m.payload), new Date(m.ts).toISOString());
  });
}

// M6 Task 3 (F8/F9): squads table store. Columns match migration v5 (the v1
// squads table was reshaped — the legacy `name` column dropped, member
// members + task added). The brief's verbatim shape: status is a plain string
// here; the state machine lives in @jarvis/core SquadMachine.
export function createSquadStore(db: Database.Database) {
  const list = () => (db.prepare('SELECT * FROM squads ORDER BY created_at DESC').all() as Array<Record<string, unknown>>).map(r => ({
    id: r.id as string, leaderAgentId: r.leader_agent_id as string, memberAgentIds: JSON.parse(r.member_agent_ids_json as string) as string[], status: r.status as string, taskId: r.task_id as string | null
  }));
  return {
    list,
    create(input: { id: string; leaderAgentId: string; memberAgentIds: string[]; taskId?: string }) {
      db.prepare('INSERT INTO squads (id, leader_agent_id, member_agent_ids_json, status, task_id, created_at) VALUES (?,?,?,?,?,?)')
        .run(input.id, input.leaderAgentId, JSON.stringify(input.memberAgentIds), 'idle', input.taskId ?? null, new Date().toISOString());
    },
    transition(id: string, event: SquadEvent) {
      const cur = list().find(s => s.id === id);
      if (!cur) throw new Error('squad not found');
      const next = squadTransition(cur.status as SquadStatus, event);
      db.prepare('UPDATE squads SET status = ? WHERE id = ?').run(next, id);
      return next;
    }
  };
}

// The runner registerTaskHandlers produces (tasks.ts): the shared engine runs
// for the leader and the members, plus a per-run prepare/teardown lifecycle so
// squad.start can scope the delegation context around a single squad run.
export interface SquadRunner extends SquadRouterDeps {
  prepare(squad: Squad): void;
  teardown(): void;
  // True while a squad run holds the shared runner context (single-active
  // enforcement in squad.start; see tasks.ts).
  isActive(): boolean;
  // M6 Task 6 (F10): a single shared-engine agent run, no squad context. Used
  // by workflow.run for each DAG node; the same per-run isolation (input.agent
  // on the M4 approval gate) as a squad member run, so concurrent nodes cannot
  // leak into each other.
  runAgentOnce(agentId: string, input: string): Promise<string>;
}

export interface SquadIpcDeps {
  db: Database.Database;
  getWindow: () => BrowserWindow | null;
  runner: SquadRunner;
}

// M6 Task 3 (F8/F9): squad IPC. Handlers always return { ok, ... } / { ok,
// error } and wrap risky work in try/catch so an ipcMain rejection never leaks
// to the renderer (same contract as the templates.*/search.* channels). The
// squad:status event mirrors the task:* events the orchestrator emits.
export function registerSquadIpc(register: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => void, deps: SquadIpcDeps): void {
  const store = createSquadStore(deps.db);
  const emit = (id: string, state: string) => deps.getWindow()?.webContents.send(IpcEvent.squadStatus, { id, state });

  register('squad.create', (_e, args) => {
    try {
      const { leaderAgentId, memberAgentIds, taskId } = (args ?? {}) as { leaderAgentId: string; memberAgentIds: string[]; taskId?: string };
      const id = randomUUID();
      const squad = createSquad({ id, leaderAgentId, memberAgentIds, taskId });
      store.create({ id: squad.id, leaderAgentId: squad.leaderAgentId, memberAgentIds: squad.memberAgentIds, taskId: squad.taskId });
      return { ok: true as const, id, squad };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // M6 Task 5 (L14): squad.graph returns a squad's delegation call chain
  // (leader -> member edges recorded by delegateRoute in tasks.ts) as
  // react-flow rows plus a cycle flag from detectCycle. Querying by squad_id
  // (migration v7) decouples the graph from the delegation taskId — in this
  // single-active milestone the delegation taskId equals the squad row id, but
  // the squad's bound task_id is a separate optional column, so keying on it
  // would miss edges. toRows() keeps the renderer contract to {from,to,label};
  // the cycle flag is cheap extra signal for a repeated (from,to,taskId)
  // delegation the UI can surface immediately.
  register('squad.graph', (_e, args) => {
    try {
      const { squadId } = (args ?? {}) as { squadId: string };
      if (!store.list().some(s => s.id === squadId)) return { ok: false as const, error: `squad not found: ${squadId}` };
      const rows = deps.db.prepare('SELECT from_agent, to_agent, task_id, ok, created_at FROM agent_call_edges WHERE squad_id = ? ORDER BY created_at').all(squadId) as Array<{ from_agent: string; to_agent: string; task_id: string | null; ok: number; created_at: string }>;
      const graph = new CallGraph();
      for (const r of rows) graph.addEdge(r.from_agent, r.to_agent, { taskId: r.task_id ?? undefined, ok: r.ok === 1 });
      return { ok: true as const, rows: graph.toRows(), cycle: detectCycle(graph.getEdges()) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  register('squad.start', async (_e, args) => {
    try {
      const { id, input } = (args ?? {}) as { id: string; input: string };
      const cur = store.list().find(s => s.id === id);
      if (!cur) return { ok: false as const, error: `squad not found: ${id}` };
      // Single-active enforcement (F8/F9 review finding 1): the runner context
      // is process-global for the shared engine, so a second concurrent start
      // would silently corrupt the active run (leader A's delegate_agent reads
      // squad B's context; the first to finish nulls squadCtx mid-flight).
      // Reject before any transition or prepare.
      if (deps.runner.isActive()) return { ok: false as const, error: 'another squad run is in progress' };
      // start before prepare so a duplicate start on an already-started squad
      // fails cleanly (invalid transition) without touching the runner context.
      store.transition(id, 'start');
      const squad: Squad = { id: cur.id, leaderAgentId: cur.leaderAgentId, memberAgentIds: cur.memberAgentIds, status: 'in_progress', taskId: cur.taskId ?? undefined };
      try {
        // prepare inside the try so a throw still reaches the finally teardown
        // (the DB would otherwise sit in_progress with a leaked runner context).
        deps.runner.prepare(squad);
        emit(id, 'in_progress');
        const result = await runSquad(squad, input, deps.runner);
        store.transition(id, 'summarized');
        emit(id, result.status);
        return { ok: true as const, result };
      } catch (e) {
        // A mid-run failure moves the squad to 'failed' so the UI does not sit
        // stuck in in_progress; the inner guard means the failed run never
        // throws again on the way out.
        try { store.transition(id, 'fail'); emit(id, 'failed'); } catch { /* already terminal */ }
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
      } finally {
        deps.runner.teardown();
      }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  register('squad.approve', (_e, args) => {
    try {
      const { id, ok } = (args ?? {}) as { id: string; ok: boolean };
      const next = store.transition(id, ok ? 'approve' : 'reject');
      emit(id, next);
      // M6 Task 8 (F15/I5): surface the human approve/reject outcome as a
      // desktop notification + in-app toast. A reject returns the squad to
      // in_progress (NOT a terminal failure), so the toast kind is 'info' for
      // reject and 'success' for approve. Lazy import keeps the 'electron'
      // module out of the Node spec graph (same rationale as the tasks.ts hook).
      // The notification body is a natural-language label, not the bare squad
      // UUID (the summary text lives only on the squad.start invoke result, not
      // on the persisted row, so it is unavailable here).
      const message = ok ? 'Squad approved' : 'Squad rejected';
      const body = ok ? `Squad ${id} was approved` : `Squad ${id} was sent back to review`;
      void import('../notify/NotificationBridge').then(({ showSystemNotification }) => showSystemNotification(message, body)).catch(() => {});
      deps.getWindow()?.webContents.send(IpcEvent.toastPush, { kind: ok ? 'success' : 'info', message });
      return { ok: true as const, status: next };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // M6 Task 6 (F10): DAG workflow orchestration. definitionJson is the raw
  // serialized Workflow; a bad JSON body, a cyclic graph (DagError from
  // topoSort) or a missing agent (runAgentOnce) all return { ok:false, error }
  // instead of an ipcMain rejection — same contract as the squad.* channels.
  // Each node's input is the composed upstream context from runWorkflow; the
  // runAgentOnce below is the same shared-engine single run the squad member
  // path uses (see tasks.ts), so a workflow node is just an agent + input with
  // no squad context involved. The UI editor is M8 (K6/DAG); this channel only
  // executes a definition the renderer hands over.
  register('workflow.run', async (_e, definitionJson) => {
    try {
      const wf = JSON.parse(definitionJson as string) as Workflow;
      const outputs = await runWorkflow(wf, async (node, context) => {
        return deps.runner.runAgentOnce(node.agentId, context);
      });
      return { ok: true as const, outputs };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
