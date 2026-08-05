import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { MessageBus, type Squad, type SquadRouterDeps } from '@jarvis/core';
import { applyMigrations } from '../db/migrations';
import { createBusPersist, getMessageBus, createSquadStore, registerSquadIpc, type SquadRunner } from './squad';

// M6 Task 1 (L12): the main-owned agent_messages table must persist every
// message posted to the shared bus. getMessageBus is a process-wide singleton,
// so each test wires its own fresh bus instance to keep assertions isolated;
// the singleton itself is exercised by IpcRouter.registerAll (see IpcRouter.spec).
describe('squad bus persistence (L12)', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('createBusPersist writes every posted message to agent_messages', () => {
    const bus = new MessageBus();
    createBusPersist(db, bus);
    const posted = bus.post({ kind: 'delegate', from: 'leader', to: 'member', taskId: 't1', payload: { subtask: 'x' } });
    const row = db.prepare('SELECT id, kind, from_agent, to_agent, task_id, payload_json, created_at FROM agent_messages').get() as {
      id: string; kind: string; from_agent: string; to_agent: string; task_id: string | null; payload_json: string; created_at: string;
    };
    expect(row).toMatchObject({
      id: posted.id,
      kind: 'delegate',
      from_agent: 'leader',
      to_agent: 'member',
      task_id: 't1',
      payload_json: JSON.stringify({ subtask: 'x' })
    });
    expect(new Date(row.created_at).getTime()).toBe(posted.ts);
  });

  it('persists null task_id for messages without one', () => {
    const bus = new MessageBus();
    createBusPersist(db, bus);
    bus.post({ kind: 'log', from: 'a', to: '*', payload: { note: 1 } });
    const row = db.prepare('SELECT task_id, payload_json FROM agent_messages').get() as { task_id: string | null; payload_json: string };
    expect(row.task_id).toBeNull();
    expect(row.payload_json).toBe('{"note":1}');
  });

  it('getMessageBus returns the same singleton instance', () => {
    expect(getMessageBus()).toBe(getMessageBus());
  });
});

// M6 Task 3 (F8/F9): createSquadStore CRUD + transitions against the v5 squads
// table. The store is a thin persistence shim over the pure SquadMachine state
// machine (both live in @jarvis/core).
describe('createSquadStore (F8)', () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(':memory:'); applyMigrations(db); });

  it('creates, lists and parses a squad row', () => {
    const store = createSquadStore(db);
    store.create({ id: 's1', leaderAgentId: 'leader', memberAgentIds: ['m1', 'm2'], taskId: 't1' });
    const rows = store.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 's1', leaderAgentId: 'leader', memberAgentIds: ['m1', 'm2'], status: 'idle', taskId: 't1'
    });
  });

  it('persists a null task_id when none is given', () => {
    const store = createSquadStore(db);
    store.create({ id: 's2', leaderAgentId: 'leader', memberAgentIds: [] });
    expect(store.list()[0].taskId).toBeNull();
  });

  it('transitions status through the state machine and persists it', () => {
    const store = createSquadStore(db);
    store.create({ id: 's3', leaderAgentId: 'leader', memberAgentIds: ['m1'] });
    expect(store.transition('s3', 'start')).toBe('in_progress');
    expect(store.transition('s3', 'summarized')).toBe('in_review');
    expect(store.transition('s3', 'approve')).toBe('completed');
    expect(store.list()[0].status).toBe('completed');
  });

  it('reject from in_review goes back to in_progress', () => {
    const store = createSquadStore(db);
    store.create({ id: 's4', leaderAgentId: 'leader', memberAgentIds: ['m1'] });
    store.transition('s4', 'start');
    store.transition('s4', 'summarized');
    expect(store.transition('s4', 'reject')).toBe('in_progress');
  });

  it('throws on a missing squad', () => {
    const store = createSquadStore(db);
    expect(() => store.transition('nope', 'start')).toThrow('squad not found');
  });
});

// M6 Task 3 (F8/F9): squad.* IPC channels. A fake runner drives the pure
// runSquad orchestrator; handlers must return { ok, ... } / { ok, error } and
// never reject.
describe('squad IPC (F8/F9)', () => {
  let db: Database.Database;
  let handlers: Map<string, (e: unknown, ...args: unknown[]) => unknown>;

  const fakeRunner = (): SquadRunner => {
    const deps: SquadRouterDeps = {
      async runLeader() { return { text: 'plan', delegations: [{ to: 'm1', subtask: 'a' }, { to: 'm2', subtask: 'b' }] }; },
      async runMember(agentId: string) { return `result of ${agentId}`; },
      async buildContext(_memberId: string, s: string) { return s; },
      async summarize(members: Array<{ agent: string; result: string }>) { return members.map(m => m.result).join(';'); }
    };
    return { prepare() {}, teardown() {}, isActive: () => false, ...deps };
  };

  // A runner whose runLeader stays pending until released, so the IPC single-
  // active check can be exercised while the first run is still in flight.
  function deferredRunner() {
    let release!: (v: { text: string; delegations: Array<{ to: string; subtask: string }> }) => void;
    const gate = new Promise<{ text: string; delegations: Array<{ to: string; subtask: string }> }>((res) => { release = res; });
    let active = false;
    const runner: SquadRunner = {
      prepare() { active = true; },
      teardown() { active = false; },
      isActive: () => active,
      async runLeader() { return gate; },
      async runMember(agentId: string) { return `result of ${agentId}`; },
      async buildContext(_memberId: string, s: string) { return s; },
      async summarize() { return 'summary'; }
    };
    return { runner, release };
  }

  beforeEach(() => {
    db = new Database(':memory:'); applyMigrations(db);
    handlers = new Map();
  });

  function register(runner: SquadRunner = fakeRunner()) {
    const events: Array<{ channel: string; payload: unknown }> = [];
    const fakeWindow = { webContents: { send: (channel: string, payload: unknown) => events.push({ channel, payload }) } };
    registerSquadIpc((ch, h) => handlers.set(ch, h), { db, getWindow: () => fakeWindow as unknown as import('electron').BrowserWindow, runner });
    return events;
  }

  it('squad.create persists a squad with a random id', () => {
    const events = register();
    const create = handlers.get('squad.create')!;
    const r = create({}, { leaderAgentId: 'leader', memberAgentIds: ['m1', 'm2'] }) as { ok: boolean; id: string; squad: Squad };
    expect(r.ok).toBe(true);
    expect(r.id).toBeTruthy();
    expect(r.squad.status).toBe('idle');
    const rows = createSquadStore(db).list();
    expect(rows).toHaveLength(1);
    expect(rows[0].leaderAgentId).toBe('leader');
    expect(events).toHaveLength(0);
  });

  it('squad.start runs the squad into in_review and emits squad:status', async () => {
    const events = register();
    const create = handlers.get('squad.create')!;
    const start = handlers.get('squad.start')!;
    const { id } = create({}, { leaderAgentId: 'leader', memberAgentIds: ['m1', 'm2'] }) as { id: string };
    const r = await start({}, { id, input: 'do the thing' }) as { ok: boolean; result: { status: string; summary: string; members: Array<{ agent: string }> } };
    expect(r.ok).toBe(true);
    expect(r.result.status).toBe('in_review');
    expect(r.result.members).toHaveLength(2);
    expect(r.result.summary).toContain('result of m1');
    expect(createSquadStore(db).list()[0].status).toBe('in_review');
    expect(events.map(e => e.channel)).toContain('squad:status');
  });

  it('squad.approve approves an in_review squad into completed', async () => {
    const events = register();
    const create = handlers.get('squad.create')!;
    const start = handlers.get('squad.start')!;
    const approve = handlers.get('squad.approve')!;
    const { id } = create({}, { leaderAgentId: 'leader', memberAgentIds: ['m1'] }) as { id: string };
    await start({}, { id, input: 'x' });
    const r = approve({}, { id, ok: true }) as { ok: boolean; status: string };
    expect(r.ok).toBe(true);
    expect(r.status).toBe('completed');
    expect(createSquadStore(db).list()[0].status).toBe('completed');
    expect(events.map(e => e.channel)).toContain('squad:status');
  });

  it('squad.start on a missing squad returns { ok:false }', async () => {
    register();
    const start = handlers.get('squad.start')!;
    const r = await start({}, { id: 'nope', input: 'x' }) as { ok: boolean; error: string };
    expect(r.ok).toBe(false);
    expect(r.error).toContain('nope');
  });

  // M6 Task 5 (L14): squad.graph returns the squad's delegation chain as
  // react-flow rows ({from,to,label}) plus a cycle flag. Edges are seeded
  // directly — the delegation route in tasks.ts writes them on completion.
  it('squad.graph returns edges as react-flow rows plus a cycle flag (L14)', async () => {
    register();
    const create = handlers.get('squad.create')!;
    const graph = handlers.get('squad.graph')!;
    const { id } = create({}, { leaderAgentId: 'leader', memberAgentIds: ['m1', 'm2'] }) as { id: string };
    db.prepare('INSERT INTO agent_call_edges (id, from_agent, to_agent, task_id, squad_id, ok, created_at) VALUES (?,?,?,?,?,?,?)')
      .run('e1', 'leader', 'm1', id, id, 1, '2026-01-01T00:00:00.000Z');
    db.prepare('INSERT INTO agent_call_edges (id, from_agent, to_agent, task_id, squad_id, ok, created_at) VALUES (?,?,?,?,?,?,?)')
      .run('e2', 'm1', 'm2', id, id, 0, '2026-01-02T00:00:00.000Z');
    const r = graph({}, { squadId: id }) as { ok: boolean; rows: Array<{ from: string; to: string; label: string }>; cycle: boolean };
    expect(r.ok).toBe(true);
    expect(r.rows).toEqual([
      { from: 'leader', to: 'm1', label: 'ok' },
      { from: 'm1', to: 'm2', label: 'failed' }
    ]);
    expect(r.cycle).toBe(false);
  });

  it('squad.graph flags a repeated delegation as a cycle', async () => {
    register();
    const create = handlers.get('squad.create')!;
    const graph = handlers.get('squad.graph')!;
    const { id } = create({}, { leaderAgentId: 'leader', memberAgentIds: ['m1'] }) as { id: string };
    db.prepare('INSERT INTO agent_call_edges (id, from_agent, to_agent, task_id, squad_id, ok, created_at) VALUES (?,?,?,?,?,?,?)')
      .run('e1', 'leader', 'm1', 't1', id, 1, '2026-01-01T00:00:00.000Z');
    db.prepare('INSERT INTO agent_call_edges (id, from_agent, to_agent, task_id, squad_id, ok, created_at) VALUES (?,?,?,?,?,?,?)')
      .run('e2', 'leader', 'm1', 't1', id, 1, '2026-01-02T00:00:00.000Z');
    const r = graph({}, { squadId: id }) as { ok: boolean; cycle: boolean };
    expect(r.ok).toBe(true);
    expect(r.cycle).toBe(true);
  });

  it('squad.graph on a missing squad returns { ok:false }', async () => {
    register();
    const graph = handlers.get('squad.graph')!;
    const r = graph({}, { squadId: 'nope' }) as { ok: boolean; error: string };
    expect(r.ok).toBe(false);
    expect(r.error).toContain('nope');
  });

  it('emits an in_progress squad:status event when the run begins', async () => {
    const events = register();
    const create = handlers.get('squad.create')!;
    const start = handlers.get('squad.start')!;
    const { id } = create({}, { leaderAgentId: 'leader', memberAgentIds: ['m1', 'm2'] }) as { id: string };
    await start({}, { id, input: 'do it' });
    const states = events.filter(e => e.channel === 'squad:status').map(e => (e.payload as { state: string }).state);
    expect(states).toContain('in_progress');
    expect(states).toContain('in_review');
  });

  it('rejects a second squad.start while a run is in progress (single-active)', async () => {
    const { runner, release } = deferredRunner();
    register(runner);
    const create = handlers.get('squad.create')!;
    const start = handlers.get('squad.start')!;
    const { id } = create({}, { leaderAgentId: 'leader', memberAgentIds: ['m1'] }) as { id: string };
    // The first start's prepare runs synchronously before its runLeader awaits
    // the gate, so the runner is active before the second start is dispatched.
    const first = start({}, { id, input: 'run one' });
    const second = await start({}, { id, input: 'run two' }) as { ok: boolean; error?: string };
    expect(second.ok).toBe(false);
    expect(second.error).toContain('another squad run is in progress');
    // Releasing the first run lets it complete unaffected.
    release({ text: 'plan', delegations: [] });
    const firstRes = await first as { ok: boolean; result?: { status: string } };
    expect(firstRes.ok).toBe(true);
    expect(firstRes.result?.status).toBe('in_review');
    expect(createSquadStore(db).list()[0].status).toBe('in_review');
  });
});
