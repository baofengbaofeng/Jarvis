import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export function SkillsSettingsPage() {
  const { t } = useTranslation('common');
  const [skills, setSkills] = useState<Array<{ id: string; name: string; description: string }>>([]);
  const refresh = async () => setSkills((await window.jarvis.invoke('skills.list')) as typeof skills);
  useEffect(() => { void refresh(); }, []);
  const pickImport = async () => {
    const dir = (await window.jarvis.invoke('dialog.openFile')) as string | null;
    if (dir) { await window.jarvis.invoke('skills.import', dir); await refresh(); }
  };
  return (
    <div data-testid="skills-settings">
      <h2>{t('menu.skills')}</h2>
      <button data-testid="skills-import" onClick={() => void pickImport()}>{t('settings.skills.import')}</button>
      <ul>{skills.map(s => <li key={s.id}>{s.name} — {s.description}</li>)}</ul>
    </div>
  );
}
