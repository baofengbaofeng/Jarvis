import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyMigrations } from '../db/migrations';
import { createWorkspaceService, createWorkspaceIpc } from './workspace';
import { createAgentStore } from './agents';

describe('workspace service', () => {
  let db: Database.Database;
  let tmp: string;
  const tmpDirs: string[] = [];

  beforeEach(() => {
    db = new Database(':memory:');
    applyMigrations(db);
    tmp = mkdtempSync(join(tmpdir(), 'jv-'));
    tmpDirs.push(tmp);
  });

  afterAll(() => {
    for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
  });

  it('bind creates .jarvis/JARVIS.md and updates agent workspaceId', () => {
    const agents = createAgentStore(db);
    const agent = agents.create({ name: 'Workspace Agent', systemPrompt: 'x', modelId: null, workspaceId: null });
    const workspace = createWorkspaceService(db);
    workspace.bind(agent.id, tmp);

    const md = join(tmp, '.jarvis', 'JARVIS.md');
    expect(existsSync(md)).toBe(true);
    expect(readFileSync(md, 'utf8')).toContain('# JARVIS 工作区上下文');
    expect(agents.get(agent.id).workspaceId).toBe(tmp);
  });

  it('bind does not overwrite an existing JARVIS.md', () => {
    const agents = createAgentStore(db);
    const agent = agents.create({ name: 'A', systemPrompt: '', modelId: null, workspaceId: null });
    const jarvisDir = join(tmp, '.jarvis');
    mkdirSync(jarvisDir, { recursive: true });
    const md = join(jarvisDir, 'JARVIS.md');
    writeFileSync(md, '# custom', 'utf8');
    const workspace = createWorkspaceService(db);
    workspace.bind(agent.id, tmp);
    expect(readFileSync(md, 'utf8')).toBe('# custom');
  });

  it('listBound returns only agents with a bound workspace', () => {
    const agents = createAgentStore(db);
    const bound = agents.create({ name: 'Bound', systemPrompt: '', modelId: null, workspaceId: null });
    agents.create({ name: 'Unbound', systemPrompt: '', modelId: null, workspaceId: null });
    const workspace = createWorkspaceService(db);
    workspace.bind(bound.id, tmp);
    expect(workspace.listBound()).toEqual([{ agentId: bound.id, path: tmp }]);
  });

  it('loadContext reads generated JARVIS.md and returns null agentMd when absent', () => {
    const agents = createAgentStore(db);
    const agent = agents.create({ name: 'Context Agent', systemPrompt: '', modelId: null, workspaceId: null });
    const workspace = createWorkspaceService(db);
    workspace.bind(agent.id, tmp);
    const ctx = workspace.loadContext(agent.id);
    expect(ctx.jarvisMd).toContain('# JARVIS 工作区上下文');
    expect(ctx.agentMd).toBeNull();
  });

  it('loadContext returns agentMd when .jarvis/agents/{slug}.md exists', () => {
    const agents = createAgentStore(db);
    const agent = agents.create({ name: 'Context Agent', systemPrompt: '', modelId: null, workspaceId: null });
    const workspace = createWorkspaceService(db);
    workspace.bind(agent.id, tmp);
    const agentDir = join(tmp, '.jarvis', 'agents');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, `${agent.slug}.md`), '# agent doc', 'utf8');
    const ctx = workspace.loadContext(agent.id);
    expect(ctx.agentMd).toBe('# agent doc');
  });

  it('loadContext returns empty context for an unbound agent', () => {
    const agents = createAgentStore(db);
    const agent = agents.create({ name: 'Solo', systemPrompt: '', modelId: null, workspaceId: null });
    const workspace = createWorkspaceService(db);
    expect(workspace.loadContext(agent.id)).toEqual({ jarvisMd: '', agentMd: null });
  });
});

// M5 Task 7 (L22): createWorkspaceIpc.copyFiles copies dropped "other" files
// into the bound workspace by basename. The getWorkspace closure is injected so
// these tests exercise the handler in isolation (no agent store needed).
describe('workspace copyFiles IPC', () => {
  let tmp: string;
  const tmpDirs: string[] = [];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'jv-copy-'));
    tmpDirs.push(tmp);
  });

  afterAll(() => {
    for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
  });

  it('copies source files into the workspace by basename', () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'jv-src-'));
    tmpDirs.push(srcDir);
    const src = join(srcDir, 'notes.txt');
    writeFileSync(src, 'hello');
    const ipc = createWorkspaceIpc(() => tmp);
    expect(ipc.copyFiles([src])).toEqual({ ok: true });
    expect(readFileSync(join(tmp, 'notes.txt'), 'utf8')).toBe('hello');
  });

  it('returns an error when no workspace is bound', () => {
    const ipc = createWorkspaceIpc(() => null);
    expect(ipc.copyFiles(['/tmp/x.txt'])).toEqual({ ok: false, error: 'no workspace' });
  });

  it('rejects a missing source path and copies nothing', () => {
    const ipc = createWorkspaceIpc(() => tmp);
    expect(ipc.copyFiles([join(tmp, 'nope.txt')])).toEqual({ ok: false, error: expect.stringContaining('not a file') });
  });
});
