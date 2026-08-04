import type { ModelMessage } from '../model/types';

export function mergeEnv(system: Record<string, string>, dotenv: Record<string, string>, agent: Record<string, string>, multica: Record<string, string>): Record<string, string> {
  return { ...system, ...dotenv, ...agent, ...multica };
}

export interface AgentContextFiles { jarvisMd: string; agentMd: string | null }

export function buildContextMessages(ctx: AgentContextFiles, systemPrompt: string, history: Array<{ role: string; content: string }>): ModelMessage[] {
  const parts = [
    systemPrompt,
    ctx.jarvisMd ? `\n\n<workspace-context>\n${ctx.jarvisMd}\n</workspace-context>` : '',
    ctx.agentMd ? `\n\n<agent-context>\n${ctx.agentMd}\n</agent-context>` : ''
  ].filter(Boolean);
  return [
    { role: 'system', content: parts.join('\n') },
    ...history.map(h => ({ role: h.role as ModelMessage['role'], content: h.content }))
  ];
}
