import { useEffect } from 'react';
import { useAgentStore } from '../../stores/agent-store';

export function AgentSwitcher() {
  const { agents, current, refresh, setCurrent } = useAgentStore();
  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div data-testid="agent-switcher">
      {agents.map(a => (
        <button key={a.id} data-testid={`agent-${a.slug}`} onClick={() => setCurrent(a)} style={{ fontWeight: current?.id === a.id ? 'bold' : 'normal' }}>
          {a.name}
        </button>
      ))}
    </div>
  );
}
