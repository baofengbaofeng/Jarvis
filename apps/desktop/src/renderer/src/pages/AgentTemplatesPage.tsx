import { AgentTemplateView } from '../components/agents/AgentTemplateView';
import type { AgentTemplate } from '@jarvis/core/renderer';

// L30 (M8 Task 8): /agents/templates route wrapper. The presentational
// AgentTemplateView stays prop-driven; this page layer wires its onCreate
// callback to the agent-templates.createAgent IPC and returns to the agent list.
export function AgentTemplatesPage() {
  const onCreate = async (t: AgentTemplate, name: string) => {
    await window.jarvis.invoke('agent-templates.createAgent', { templateId: t.id, name });
    window.location.href = '/agents';
  };
  return <AgentTemplateView onCreate={onCreate} />;
}
