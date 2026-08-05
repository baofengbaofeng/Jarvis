import type Database from 'better-sqlite3';
import type { BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { MessageBus, createSquad, squadTransition, runSquad, type Squad, type SquadEvent, type SquadRouterDeps, type SquadStatus } from '@jarvis/core';
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
      return { ok: true as const, status: next };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
