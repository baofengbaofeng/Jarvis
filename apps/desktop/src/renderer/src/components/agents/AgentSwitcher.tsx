import { useEffect } from 'react';
import { useAgentStore } from '../../stores/agent-store';

export function AgentSwitcher() {
  const { agents, current, refresh, setCurrent } = useAgentStore();
  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div data-testid="agent-switcher" className="agent-switcher">
      {agents.map(a => (
        <button
          key={a.id}
          data-testid={`agent-${a.slug}`}
          className={`agent-switcher__btn${current?.id === a.id ? ' agent-switcher__btn--active' : ''}`}
          onClick={() => setCurrent(a)}
        >
          {a.name}
        </button>
      ))}
    </div>
  );
}
