import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../stores/agent-store';
import { AgentDetailPage } from './AgentDetailPage';

export function AgentListView() {
  const { t } = useTranslation('common');
  const { agents, refresh } = useAgentStore();
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div data-testid="agent-list">
      <h2>{t('menu.agents')}</h2>
      {editing !== null && (
        <AgentDetailPage
          key={editing}
          agentId={editing === '__new__' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <ul>
        {agents.map(a => (
          <li key={a.id}>
            {a.name} <button onClick={() => setEditing(a.id)}>{t('common.edit')}</button>
          </li>
        ))}
      </ul>
      <button data-testid="agent-add" onClick={() => setEditing('__new__')}>{t('settings.provider.add')}</button>
    </div>
  );
}
