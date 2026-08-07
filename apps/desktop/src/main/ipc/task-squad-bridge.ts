import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  ToolRegistry,
  buildPassedContext,
  createGuard,
  DelegateGuardError,
  registerDelegateTool,
  planVisibleTools,
  type Squad,
  type SquadRouterDeps,
} from '@jarvis/core';
import type { AgentEngine } from '@jarvis/core';
import { registerAgentMcpTools, mcpVisibilityForAgent } from './mcp';
import { getMessageBus } from './squad';
import type { createAgentStore } from './agents';

export interface ResolvedAgentRun {
  agent: ReturnType<ReturnType<typeof createAgentStore>['get']>;
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>;
  env: Record<string, string>;
  apiKey: string;
  provider: { type: 'openai-compatible' | 'anthropic-compatible'; baseUrl: string };
  modelId: string;
  workspaceRoot: string;
  policy: import('@jarvis/core').SandboxPolicy;
}

export interface SquadBridgeDeps {
  db: Database.Database;
  agentStore: ReturnType<typeof createAgentStore>;
  engine: AgentEngine;
  toolRegistry: ToolRegistry;
  resolveAgentRun: (agentId: string, prompt: string) => Promise<ResolvedAgentRun>;
  registerMemoryToolsFor: (agentId: string) => void;
}

export type SquadRunner = SquadRouterDeps & {
  prepare(squad: Squad): void;
  teardown(): void;
  isActive(): boolean;
  runAgentOnce(agentId: string, input: string): Promise<string>;
  getActiveLeaderId: () => string | null;
};

export function createSquadRunner(deps: SquadBridgeDeps): SquadRunner {
  const { db, agentStore, engine, toolRegistry, resolveAgentRun, registerMemoryToolsFor } = deps;
  let squadCtx: { guard: ReturnType<typeof createGuard>; leaderAgentId: string; taskId: string; input: string; memberResults: Map<string, string>; memberActive: boolean } | null = null;

  const runMemberAgent = async (agentId: string, prompt: string): Promise<string> => {
    const run = await resolveAgentRun(agentId, prompt);
    await registerAgentMcpTools(db, toolRegistry, agentId);
    registerMemoryToolsFor(agentId);
    // CORE-19 / CORE-20: per-run visibility + MCP binding filter.
    const afterPlan = planVisibleTools(toolRegistry.list().map(t => t.name), run.agent.planOnly);
    const { visibleTools, toolFilter } = mcpVisibilityForAgent(db, agentId, afterPlan);
    const result = await engine.run({ ...run, cwd: run.workspaceRoot, visibleTools, toolFilter });
    return result.text;
  };

  const buildMemberPrompt = (subtask: string, context: string): string =>
    context ? `[Leader 指示]\n${context}\n\n[子任务]\n${subtask}` : subtask;

  const recordCallEdge = (from: string, to: string, taskId: string, squadId: string | null, ok: boolean): void => {
    try {
      db.prepare('INSERT INTO agent_call_edges (id, from_agent, to_agent, task_id, squad_id, ok, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(randomUUID(), from, to, taskId, squadId, ok ? 1 : 0, new Date().toISOString());
    } catch { /* best-effort */ }
  };

  const delegateRoute = async (to: string, subtask: string, from: string, taskId: string): Promise<string> => {
    if (!squadCtx) throw new Error('delegate_agent called outside a squad run');
    const ctx = squadCtx;
    const squadRow = db.prepare('SELECT leader_agent_id, member_agent_ids_json FROM squads WHERE id = ?').get(taskId) as { leader_agent_id: string; member_agent_ids_json: string } | undefined;
    if (!squadRow || squadRow.leader_agent_id !== from) throw new Error(`agent ${from} is not a squad leader`);
    const members = JSON.parse(squadRow.member_agent_ids_json ?? '[]') as string[];
    if (!members.includes(to)) throw new Error(`agent ${to} is not a member of squad ${taskId}`);
    const bus = getMessageBus();
    bus.post({ kind: 'delegate', from, to, taskId, payload: { subtask } });
    ctx.memberActive = true;
    try {
      const member = agentStore.get(to);
      const processed = await buildPassedContext(member.contextPassing ?? 'full', ctx.input);
      const text = await runMemberAgent(to, buildMemberPrompt(subtask, processed));
      ctx.memberResults.set(to, text);
      bus.post({ kind: 'response', from: to, to: from, taskId, payload: { text } });
      bus.post({ kind: 'complete', from: to, to: from, taskId, payload: { ok: true } });
      recordCallEdge(from, to, taskId, ctx.taskId, true);
      return text;
    } catch (e) {
      bus.post({ kind: 'complete', from: to, to: from, taskId, payload: { ok: false, error: e instanceof Error ? e.message : String(e) } });
      recordCallEdge(from, to, taskId, ctx.taskId, false);
      throw e;
    } finally {
      ctx.memberActive = false;
    }
  };

  registerDelegateTool(toolRegistry, {
    get guard() { return squadCtx?.guard ?? createGuard(); },
    fromAgent: (ctx) => {
      if (squadCtx?.memberActive) throw new DelegateGuardError('members cannot delegate');
      return ctx.agent?.id ?? squadCtx?.leaderAgentId ?? '';
    },
    taskHash: (subtask) => squadCtx ? `${squadCtx.taskId}:${subtask}` : subtask,
    taskId: () => squadCtx?.taskId ?? '',
    route: delegateRoute
  });

  return {
    prepare(squad: Squad): void {
      squadCtx = { guard: createGuard(), leaderAgentId: squad.leaderAgentId, taskId: squad.id, input: '', memberResults: new Map(), memberActive: false };
    },
    teardown(): void { squadCtx = null; },
    isActive(): boolean { return squadCtx !== null; },
    getActiveLeaderId: () => squadCtx?.leaderAgentId ?? null,
    async runLeader(input: string): Promise<{ text: string; delegations: Array<{ to: string; subtask: string }> }> {
      if (!squadCtx) throw new Error('squad runner used without prepare');
      squadCtx.input = input;
      const leader = await resolveAgentRun(squadCtx.leaderAgentId, input);
      await registerAgentMcpTools(db, toolRegistry, squadCtx.leaderAgentId);
      registerMemoryToolsFor(squadCtx.leaderAgentId);
      const delegations: Array<{ to: string; subtask: string }> = [];
      // CORE-19 / CORE-20: per-run visibility + MCP binding filter on the leader run.
      const afterPlan = planVisibleTools(toolRegistry.list().map(t => t.name), leader.agent.planOnly);
      const { visibleTools, toolFilter } = mcpVisibilityForAgent(db, squadCtx.leaderAgentId, afterPlan);
      const result = await engine.run({
        ...leader, cwd: leader.workspaceRoot, visibleTools, toolFilter,
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
      return runMemberAgent(agentId, buildMemberPrompt(subtask, context));
    },
    async runAgentOnce(agentId: string, input: string): Promise<string> {
      return runMemberAgent(agentId, input);
    },
    buildContext: async (memberId: string, result: string): Promise<string> => {
      const member = agentStore.get(memberId);
      return buildPassedContext(member.contextPassing ?? 'full', result);
    },
    summarize: async (members: Array<{ agent: string; result: string }>): Promise<string> => members.map(m => m.result).join('\n')
  };
}
