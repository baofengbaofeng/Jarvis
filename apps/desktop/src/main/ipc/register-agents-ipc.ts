import type Database from 'better-sqlite3';
import { IpcChannel } from '@jarvis/protocol';
import { createAgentStore, type AgentInput } from './agents';
import { createAgentTemplatesIpc } from './agent-templates';
import { createMcpStore, testMcpServer, type McpServerInput } from './mcp';
import { createSkillsStore } from './skills';
import { createWorkspaceService } from './workspace';

type Handler = (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown;
type Register = (channel: string, handler: Handler) => void;

/** Agents, templates, MCP, skills, and workspace binding IPC. */
export function registerAgentsIpc(register: Register, db: Database.Database): {
  agents: ReturnType<typeof createAgentStore>;
  getWorkspace: () => string | null;
} {
  const agents = createAgentStore(db);
  register(IpcChannel.agentList, () => agents.list());
  register(IpcChannel.agentCreate, (_e, input) => agents.create(input as AgentInput));
  register(IpcChannel.agentUpdate, (_e, id, patch) => agents.update(id as string, patch as Partial<AgentInput>));
  register(IpcChannel.agentDelete, (_e, id) => agents.remove(id as string));
  register(IpcChannel.agentVersions, (_e, args) => {
    try {
      const { id } = (args ?? {}) as { id: string };
      agents.get(id);
      return { ok: true as const, versions: agents.versions.list(id) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });
  register(IpcChannel.agentRollback, (_e, args) => {
    try {
      const { id, versionId } = (args ?? {}) as { id: string; versionId: string };
      if (!db.prepare('SELECT 1 FROM agent_config_versions WHERE id = ? AND agent_id = ?').get(versionId, id)) {
        return { ok: false as const, error: `version ${versionId} not found for agent ${id}` };
      }
      agents.versions.rollback(versionId, id);
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });
  const agentTemplates = createAgentTemplatesIpc((input: { name: string; systemPrompt: string; workspaceId: string | null }) =>
    agents.create({ name: input.name, systemPrompt: input.systemPrompt, modelId: null, workspaceId: input.workspaceId }));
  register('agent-templates.list', () => agentTemplates.list());
  register('agent-templates.createAgent', (_e, input) => agentTemplates.createAgent(_e, input as { templateId: string; name: string; workspaceId?: string }));
  const mcpStore = createMcpStore(db);
  const skillsStore = createSkillsStore(db, agents);
  register('mcp.list', () => mcpStore.list());
  register('mcp.create', (_e, input) => mcpStore.create(input as McpServerInput));
  register('mcp.delete', (_e, id) => mcpStore.remove(id as string));
  register('mcp.test', (_e, input) => testMcpServer(input as McpServerInput));
  register('skills.list', () => skillsStore.list());
  register('skills.import', (_e, dir) => skillsStore.importFromDir(dir as string));
  register('skills.delete', (_e, id) => skillsStore.remove(id as string));
  const workspace = createWorkspaceService(db);
  register('workspace.bind', (_e, agentId, path) => { workspace.bind(agentId as string, path as string); return { ok: true }; });
  register('workspace.listBound', () => workspace.listBound());
  register('workspace.loadContext', (_e, agentId) => workspace.loadContext(agentId as string));
  const getWorkspace = (): string | null => agents.list().find(a => a.workspaceId)?.workspaceId ?? null;
  return { agents, getWorkspace };
}
