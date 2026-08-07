import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, PageHeader, Panel } from '@jarvis/ui';

const SKILL_ERROR_KEYS: Record<string, string> = {
  SKILL_NAME_INVALID: 'settings.skills.errors.nameInvalid',
  SKILL_EXISTS: 'settings.skills.errors.exists',
  SKILL_CONTENT_TYPE: 'settings.skills.errors.contentType',
  SKILL_PATH_ESCAPE: 'settings.skills.errors.pathEscape',
};

function mapSkillError(code: string | undefined, t: (key: string) => string): string {
  if (!code) return t('settings.skills.importFailed');
  const key = SKILL_ERROR_KEYS[code];
  return key ? t(key) : t('settings.skills.importFailed');
}

export function SkillsSettingsPage() {
  const { t } = useTranslation('common');
  const [skills, setSkills] = useState<Array<{ id: string; name: string; description: string }>>([]);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const refresh = async () => setSkills((await window.jarvis.invoke('skills.list')) as typeof skills);
  useEffect(() => { void refresh(); }, []);
  const pickImport = async () => {
    const caps = (await window.jarvis.invoke('dialog.pickPath', { purpose: 'skills-import' })) as Array<{ token: string }>;
    const cap = caps[0];
    if (cap) {
      try {
        await window.jarvis.invoke('skills.importLocal', { capability: cap.token });
        setError('');
        await refresh();
      } catch (e) {
        setError(mapSkillError(e instanceof Error ? e.message : undefined, t));
      }
    }
  };
  const importUrl = async () => {
    const result = (await window.jarvis.invoke('skills.importUrl', { url })) as { ok: boolean; error?: string };
    if (!result.ok) {
      setError(mapSkillError(result.error, t));
      return;
    }
    setError('');
    setUrl('');
    await refresh();
  };
  return (
    <div data-testid="skills-settings" className="page form-stack settings-page">
      <PageHeader
        title={t('menu.skills')}
        actions={<Button variant="primary" data-testid="skills-import" onClick={() => void pickImport()}>{t('settings.skills.importLocal')}</Button>}
      />
      <Panel className="settings-inline-row">
        <Input
          data-testid="skills-url-input"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder={t('settings.skills.urlPlaceholder')}
        />
        <Button variant="ghost" data-testid="skills-import-url" onClick={() => void importUrl()}>{t('settings.skills.importUrl')}</Button>
      </Panel>
      {error ? <p data-testid="skills-import-error" className="error-text">{error}</p> : null}
      <ul className="settings-card-list">
        {skills.map(s => (
          <li key={s.id}>
            <Panel className="settings-card">
              <div className="settings-card__title">{s.name}</div>
              <div className="settings-card__meta">{s.description}</div>
            </Panel>
          </li>
        ))}
      </ul>
    </div>
  );
}
