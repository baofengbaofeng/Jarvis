import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
// Renderer-safe entry: AgentTemplate is pure data (no node:*), so it must come
// from `@jarvis/core/renderer`, never the full `@jarvis/core` barrel.
import type { AgentTemplate } from '@jarvis/core/renderer';

export interface AgentTemplateViewProps {
  // The page layer wires this to `window.jarvis.invoke('agent-templates.createAgent', { templateId: t.id, name })`.
  onCreate: (t: AgentTemplate, name: string) => void;
}

export function AgentTemplateView({ onCreate }: AgentTemplateViewProps) {
  const { t } = useTranslation('common');
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    void (async () => {
      try {
        setTemplates((await window.jarvis.invoke('agent-templates.list')) as AgentTemplate[]);
        setError('');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);
  return (
    <div data-testid="template-view">
      {error && <div data-testid="template-error" role="alert">{error}</div>}
      {templates.map(tpl => (
        <div key={tpl.id} data-testid="template-card">
          <span>{tpl.icon}</span>
          <span data-testid={`template-name-${tpl.id}`}>{t(tpl.nameKey)}</span>
          <span data-testid={`template-desc-${tpl.id}`}>{t(tpl.descriptionKey)}</span>
          {tpl.defaultSkills.length > 0 && (
            <span data-testid={`template-skills-${tpl.id}`}>{tpl.defaultSkills.join(', ')}</span>
          )}
          <input data-testid={`name-${tpl.id}`} value={name} onChange={e => setName(e.target.value)} placeholder={t('templates.name')} />
          <button data-testid={`create-${tpl.id}`} onClick={() => onCreate(tpl, name)}>{t('templates.create')}</button>
        </div>
      ))}
    </div>
  );
}
