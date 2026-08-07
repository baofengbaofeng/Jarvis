import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Panel, ToolChip } from '@jarvis/ui';
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
    <div data-testid="template-view" className="template-view">
      {error && <div data-testid="template-error" role="alert" className="error-text">{error}</div>}
      {templates.map(tpl => (
        <Panel key={tpl.id} data-testid="template-card" className="template-card">
          <div className="template-card__header">
            <span className="template-card__icon">{tpl.icon}</span>
            <div>
              <div data-testid={`template-name-${tpl.id}`} className="template-card__title">{t(tpl.nameKey)}</div>
              <div data-testid={`template-desc-${tpl.id}`} className="template-card__desc">{t(tpl.descriptionKey)}</div>
            </div>
          </div>
          {tpl.defaultSkills.length > 0 && (
            <div data-testid={`template-skills-${tpl.id}`} className="template-card__skills">
              {tpl.defaultSkills.map(skill => <ToolChip key={skill} name={skill} />)}
            </div>
          )}
          <div className="template-card__actions">
            <Input data-testid={`name-${tpl.id}`} value={name} onChange={e => setName(e.target.value)} placeholder={t('templates.name')} />
            <Button data-testid={`create-${tpl.id}`} variant="primary" onClick={() => onCreate(tpl, name)}>{t('templates.create')}</Button>
          </div>
        </Panel>
      ))}
    </div>
  );
}
