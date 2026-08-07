import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@jarvis/ui';
import { useAgentStore } from '../stores/agent-store';
import { AgentDetailPage } from './AgentDetailPage';

export function AgentListView() {
  const { t } = useTranslation('common');
  const { agents, refresh } = useAgentStore();
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div data-testid="agent-list" className="page agent-list">
      <div className="page__header">
        <h2 className="page__title">{t('menu.agents')}</h2>
        <div className="page__actions">
          <Button variant="primary" data-testid="agent-add" onClick={() => setEditing('__new__')}>
            {t('settings.provider.add')}
          </Button>
          <Button variant="ghost" data-testid="agent-templates" onClick={() => { window.location.href = '/agents/templates'; }}>
            {t('menu.templates')}
          </Button>
        </div>
      </div>
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
            <span>{a.name}</span>
            <Button variant="ghost" size="sm" onClick={() => setEditing(a.id)}>{t('common.edit')}</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
