import type Database from 'better-sqlite3';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAgentStore } from './agents';

const JARVIS_MD_TEMPLATE = `# JARVIS 工作区上下文
更新此文件以记录本项目的构建、测试命令与约定,Agent 每次任务都会读取。`;

export function createWorkspaceService(db: Database.Database) {
  const agents = createAgentStore(db);

  return {
    bind(agentId: string, path: string): void {
      agents.update(agentId, { workspaceId: path });
      const dir = join(path, '.jarvis');
      mkdirSync(dir, { recursive: true });
      const md = join(dir, 'JARVIS.md');
      if (!existsSync(md)) writeFileSync(md, JARVIS_MD_TEMPLATE, 'utf8');
    },
    listBound(): Array<{ agentId: string; path: string }> {
      return agents.list().filter(a => a.workspaceId).map(a => ({ agentId: a.id, path: a.workspaceId! }));
    },
    loadContext(agentId: string): { jarvisMd: string; agentMd: string | null } {
      const agent = agents.get(agentId);
      if (!agent.workspaceId) return { jarvisMd: '', agentMd: null };
      const base = agent.workspaceId;
      let jarvisMd = '';
      try { jarvisMd = readFileSync(join(base, '.jarvis', 'JARVIS.md'), 'utf8'); } catch { /* ignore */ }
      let agentMd: string | null = null;
      try { agentMd = readFileSync(join(base, '.jarvis', 'agents', `${agent.slug}.md`), 'utf8'); } catch { /* ignore */ }
      return { jarvisMd, agentMd };
    }
  };
}
