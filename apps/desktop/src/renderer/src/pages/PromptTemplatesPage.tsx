import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Panel, Textarea } from '@jarvis/ui';
// Renderer-safe entry: listTemplateVars/substituteTemplate are pure helpers and
// the page runs them in the browser, so they must NOT come from the full
// `@jarvis/core` barrel (which pulls node:* modules).
import { listTemplateVars, substituteTemplate } from '@jarvis/core/renderer';

export interface PromptTemplate { id: string; name: string; content: string }

interface PromptTemplatesPageProps {
  // "插入到输入框" (D15): the mount site (OfficePage) wires this to the chat
  // input. Optional so the page renders standalone; defaults to a no-op.
  onInsert?: (text: string) => void;
}

export function PromptTemplatesPage({ onInsert }: PromptTemplatesPageProps) {
  const { t } = useTranslation('common');
  const [tpls, setTpls] = useState<PromptTemplate[]>([]);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  // Every window.jarvis invoke is wrapped so a rejected IPC (or a non-ok
  // channel response) surfaces as an inline error instead of an unhandled
  // rejection — same pattern as SelectionMenu/PdfReaderPage.
  const refresh = useCallback(async () => {
    try {
      setTpls((await window.jarvis.invoke('templates.list')) as PromptTemplate[]);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const save = async () => {
    try {
      const r = (await window.jarvis.invoke('templates.create', { name, content })) as { ok?: boolean; error?: string };
      if (r.ok === false) { setError(r.error ?? t('templates.error')); return; }
      setName('');
      setContent('');
      setError('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const renderPreview = async (id: string) => {
    try {
      const r = (await window.jarvis.invoke('templates.render', { id, vars: { name: 'Jarvis' } })) as { ok?: boolean; result?: string; error?: string };
      if (r.ok === false) { setPreview(''); setError(r.error ?? t('templates.error')); return; }
      setPreview(r.result ?? '');
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const insert = (tpl: PromptTemplate) => {
    // Substitute locally with the same vars the render preview uses, so insert
    // works without a render round-trip (and shows the user exactly what lands
    // in the input). A missing onInsert prop is a no-op.
    onInsert?.(substituteTemplate(tpl.content, { name: 'Jarvis' }));
  };
  const detectedVars = listTemplateVars(content);
  return (
    <div data-testid="prompt-templates" className="prompt-templates">
      <h2 className="prompt-templates__title">{t('templates.title')}</h2>
      <Panel className="prompt-templates__form form-stack">
        <Input data-testid="tpl-name" value={name} onChange={e => setName(e.target.value)} placeholder={t('templates.name')} />
        <div data-selection-menu>
          <Textarea data-testid="tpl-text" value={content} onChange={e => setContent(e.target.value)} placeholder={t('templates.textPlaceholder')} rows={6} />
        </div>
        <div data-testid="tpl-vars" className="prompt-templates__vars">{t('templates.variables')}: {detectedVars.length ? detectedVars.join(', ') : '—'}</div>
        <Button data-testid="tpl-save" variant="primary" onClick={() => void save()}>{t('templates.save')}</Button>
        {error && <div data-testid="tpl-error" role="alert" className="error-text">{error}</div>}
      </Panel>
      <ul className="prompt-templates__list">
        {tpls.map(tpl => (
          <li key={tpl.id}>
            <Panel className="prompt-templates__item">
              <span className="prompt-templates__item-name">{tpl.name}</span>
              <div className="prompt-templates__item-actions">
                <Button variant="ghost" size="sm" data-testid={`tpl-render-${tpl.id}`} onClick={() => void renderPreview(tpl.id)}>{t('templates.preview')}</Button>
                <Button variant="ghost" size="sm" data-testid={`tpl-insert-${tpl.id}`} onClick={() => insert(tpl)}>{t('templates.insert')}</Button>
              </div>
            </Panel>
          </li>
        ))}
      </ul>
      <Panel data-testid="tpl-preview" className="prompt-templates__preview" data-selection-menu>{preview}</Panel>
    </div>
  );
}
