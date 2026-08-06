import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import {
  AgentEngine,
  ToolRegistry,
  createAdapter,
  createGuard,
  createApprovalGate,
  createFileTools,
  createShellTool,
  createGitTools,
  registerRunTestsTool,
  registerSearchCodeTool,
  registerMemoryTools,
  isPlanBlocked,
  MemoryStore,
  IndexStore,
  hashEmbedding,
  type EngineChatFn,
  type SandboxPolicy,
  type Usage,
} from '@jarvis/core';
import { sqliteAuditSink } from '../audit/sqliteAuditSink';
import { createMemoryAdapter } from './memory';
import { webSearch } from './search';
import { ApprovalCenter } from '../approval/ApprovalCenter';
import type { SettingsStore } from './settings';
import { createCodeIndexAdapter } from './coding';
import { appendAudit } from './task-messages';

export interface TaskEngineDeps {
  chatFn?: EngineChatFn;
  maxSteps?: number;
  settings?: SettingsStore;
}

export interface TaskEngineRuntime {
  engine: AgentEngine;
  toolRegistry: ToolRegistry;
  approval: ApprovalCenter;
  memory: MemoryStore;
  registerMemoryToolsFor: (agentId: string) => void;
}

export function createDefaultChatFn(): EngineChatFn {
  return async (req, opts) => {
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
}

export function createTaskEngineRuntime(
  db: Database.Database,
  getWindow: () => BrowserWindow | null,
  deps: TaskEngineDeps = {},
): TaskEngineRuntime {
  const auditSink = sqliteAuditSink(db);
  const toolRegistry = new ToolRegistry({ onExec: (e) => auditSink.write({ ts: new Date(e.ts).toISOString(), kind: 'tool_call', actor: 'agent', action: e.tool, target: String(e.args).slice(0, 200), result: e.result }) });
  const memory = new MemoryStore(createMemoryAdapter(db));
  const registerMemoryToolsFor = (agentId: string): void => registerMemoryTools(toolRegistry, memory, agentId);
  const toolPolicy: SandboxPolicy = { level: 'readwrite', allowDomains: [], allowCommands: [] };
  createFileTools(toolRegistry, toolPolicy);
  createShellTool(toolRegistry, toolPolicy);
  createGitTools(toolRegistry, toolPolicy);
  const testPolicy: SandboxPolicy = { level: 'readwrite', allowDomains: [], allowCommands: ['npm test', 'pnpm test', 'yarn test'] };
  registerRunTestsTool(toolRegistry, testPolicy);
  registerSearchCodeTool(toolRegistry, new IndexStore(createCodeIndexAdapter(db), hashEmbedding));
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
  const chatFn = deps.chatFn ?? createDefaultChatFn();
  const engine = new AgentEngine({
    modelRouter: { chat: chatFn },
    toolRegistry,
    maxSteps: deps.maxSteps ?? 10,
    approvalGate: async (req) => {
      if (req.agent.planOnly && isPlanBlocked(req.toolName)) {
        appendAudit(db, { agentId: req.agent.id, kind: 'approval', detail: { toolName: req.toolName, ok: false, reason: 'plan_only_blocked' } });
        auditSink.write({ ts: new Date().toISOString(), kind: 'tool_call', actor: 'agent', action: req.toolName, target: String(req.args).slice(0, 200), result: 'denied' });
        return false;
      }
      const grants = db.prepare('SELECT server_id, tool_name FROM mcp_grants WHERE granted = 1 AND (agent_id = ? OR agent_id = ?)').all(req.agent.id, '') as Array<{ server_id: string; tool_name: string }>;
      const allowAlways = ['read_file', 'list_dir', ...grants.map(g => `mcp:${g.server_id}:${g.tool_name}`)];
      const decision = approvalGate.evaluate(req.toolName, req.args, { allowAlways, sensitiveCommands: [] });
      if (decision === 'allow' && req.toolName !== 'git_commit') return true;
      const ok = await approval.request(req);
      appendAudit(db, { agentId: req.agent.id, kind: 'approval', detail: { toolName: req.toolName, ok } });
      if (!ok) {
        auditSink.write({ ts: new Date().toISOString(), kind: 'tool_call', actor: 'agent', action: req.toolName, target: String(req.args).slice(0, 200), result: 'denied' });
      }
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
  return { engine, toolRegistry, approval, memory, registerMemoryToolsFor };
}
