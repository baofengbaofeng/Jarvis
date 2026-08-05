import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { MessageBus, type Squad, type SquadRouterDeps } from '@jarvis/core';
import { applyMigrations } from '../db/migrations';
import { createBusPersist, createSquadEventPush, getMessageBus, createSquadStore, registerSquadIpc, type SquadRunner } from './squad';

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
    return { prepare() {}, teardown() {}, isActive: () => false, ...deps, async runAgentOnce(agentId: string, input: string) { return `once(${agentId})=${input}`; } };
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
      async summarize() { return 'summary'; },
      async runAgentOnce(agentId: string, input: string) { return `once(${agentId})=${input}`; }
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

  // K5 (M6 Task 10): squad.current returns the FULL state of the most recent
  // squad — identity + status from the squads row, summary/members from the
  // last squad.start result (stashed on the runner), graphRows from the graph
  // query. This is what lets SquadViewPage drive the ApprovalPanel with real
  // review detail (the Task 8 summary/members gap).
  it('squad.current returns the full state of the most recent squad (K5)', async () => {
    register();
    const create = handlers.get('squad.create')!;
    const start = handlers.get('squad.start')!;
    const current = handlers.get('squad.current')!;
    const { id } = create({}, { leaderAgentId: 'leader', memberAgentIds: ['m1', 'm2'] }) as { id: string };
    await start({}, { id, input: 'do the thing' });
    // Seed one delegation edge so current embeds graphRows from the graph query.
    db.prepare('INSERT INTO agent_call_edges (id, from_agent, to_agent, task_id, squad_id, ok, created_at) VALUES (?,?,?,?,?,?,?)')
      .run('e1', 'leader', 'm1', id, id, 1, '2026-01-01T00:00:00.000Z');
    const r = current({}) as { ok: boolean; squad: { id: string; leaderAgentId: string; memberAgentIds: string[]; status: string; summary: string; members: Array<{ agent: string; result: string }>; graphRows: Array<{ from: string; to: string; label: string }> } };
    expect(r.ok).toBe(true);
    expect(r.squad.id).toBe(id);
    expect(r.squad.leaderAgentId).toBe('leader');
    expect(r.squad.memberAgentIds).toEqual(['m1', 'm2']);
    expect(r.squad.status).toBe('in_review');
    expect(r.squad.summary).toContain('result of m1');
    expect(r.squad.members).toHaveLength(2);
    expect(r.squad.graphRows).toEqual([{ from: 'leader', to: 'm1', label: 'ok' }]);
  });

  it('squad.current returns { ok:true, squad:null } when no squad exists', () => {
    register();
    const current = handlers.get('squad.current')!;
    const r = current({}) as { ok: boolean; squad: null };
    expect(r.ok).toBe(true);
    expect(r.squad).toBeNull();
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

  // M6 Task 6 (F10): workflow.run executes a DAG definition through the shared
  // engine (the fake runAgentOnce stands in for the tasks.ts single-run). The
  // handler owns JSON.parse + runWorkflow + runAgentOnce; any failure (bad
  // JSON, cyclic graph, missing agent) returns { ok:false, error } and never
  // rejects the channel.
  describe('workflow.run (F10)', () => {
    const wfJson = JSON.stringify({
      nodes: [
        { id: 'a', agentId: 'A', input: 'seed' },
        { id: 'b', agentId: 'B', input: '' },
        { id: 'c', agentId: 'C', input: '' }
      ],
      edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'c' }]
    });

    it('executes in topo order and injects upstream output into downstream input', async () => {
      register();
      const run = handlers.get('workflow.run')!;
      const r = await run({}, wfJson) as { ok: boolean; outputs: Record<string, string> };
      expect(r.ok).toBe(true);
      // runAgentOnce('B', ...) receives a's output injected as its context;
      // c receives a and b's outputs.
      expect(r.outputs.b).toContain('once(A)=seed');
      expect(r.outputs.c).toContain('once(A)=');
      expect(r.outputs.c).toContain('once(B)=');
    });

    it('returns { ok:false } for a cyclic definition', async () => {
      register();
      const run = handlers.get('workflow.run')!;
      const cyc = JSON.stringify({ nodes: [{ id: 'x', agentId: 'X', input: '' }, { id: 'y', agentId: 'Y', input: '' }], edges: [{ from: 'x', to: 'y' }, { from: 'y', to: 'x' }] });
      const r = await run({}, cyc) as { ok: boolean; error: string };
      expect(r.ok).toBe(false);
      expect(r.error).toContain('cycle');
    });

    it('returns { ok:false } for bad JSON', async () => {
      register();
      const run = handlers.get('workflow.run')!;
      const r = await run({}, 'not json') as { ok: boolean; error: string };
      expect(r.ok).toBe(false);
      expect(r.error).toBeTruthy();
    });

    it('returns { ok:false } when a node agent is missing', async () => {
      register({
        ...fakeRunner(),
        async runAgentOnce(agentId: string) { if (agentId === 'NOPE') throw new Error('agent not found: NOPE'); return 'x'; }
      });
      const run = handlers.get('workflow.run')!;
      const bad = JSON.stringify({ nodes: [{ id: 'n', agentId: 'NOPE', input: 'hi' }], edges: [] });
      const r = await run({}, bad) as { ok: boolean; error: string };
      expect(r.ok).toBe(false);
      expect(r.error).toContain('NOPE');
    });
  });
});

// K5 (M6 Task 10): createSquadEventPush forwards squad-shaped bus messages to
// the renderer as 'squad:event' (a SquadEvent { agent, ts, kind, detail }) so
// the squad timeline streams live. The unsubscribe handle is what IpcRouter
// dispose() relies on, so dropping the push must stop the forwarding.
describe('createSquadEventPush (K5)', () => {
  it('forwards squad-shaped bus messages to the renderer as squad:event', () => {
    const bus = new MessageBus();
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const fakeWindow = { webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } };
    createSquadEventPush(bus, () => fakeWindow as unknown as import('electron').BrowserWindow);
    bus.post({ kind: 'delegate', from: 'leader', to: 'm1', taskId: 't1', payload: { subtask: 'x' } });
    bus.post({ kind: 'response', from: 'm1', to: 'leader', taskId: 't1', payload: { text: 'done' } });
    const events = sent.filter(e => e.channel === 'squad:event');
    expect(events).toHaveLength(2);
    const first = events[0].payload as { agent: string; ts: number; kind: string; detail: string };
    expect(first.agent).toBe('leader');
    expect(first.kind).toBe('delegate');
    expect(first.detail).toContain('→ m1');
    expect(first.ts).toBeTruthy();
  });

  it('stops forwarding after the returned unsubscribe runs', () => {
    const bus = new MessageBus();
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const fakeWindow = { webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) } };
    const unsub = createSquadEventPush(bus, () => fakeWindow as unknown as import('electron').BrowserWindow);
    bus.post({ kind: 'delegate', from: 'a', to: 'b', taskId: 't', payload: {} });
    unsub();
    bus.post({ kind: 'complete', from: 'b', to: 'a', taskId: 't', payload: { ok: true } });
    expect(sent).toHaveLength(1);
  });
});
