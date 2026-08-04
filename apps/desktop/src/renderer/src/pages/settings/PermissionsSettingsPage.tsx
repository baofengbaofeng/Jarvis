import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../stores/agent-store';

export type SandboxLevel = 'readonly' | 'readwrite' | 'system';

export function PermissionsSettingsPage() {
  const { t } = useTranslation('common');
  const { agents, refresh } = useAgentStore();
  const [selected, setSelected] = useState<string>('');
  const [level, setLevel] = useState<SandboxLevel>('readwrite');
  useEffect(() => { void refresh(); }, [refresh]);

  // Load the agent's saved policy when selected so the form reflects reality
  // (C6/J6: the sandbox level shown is the one task.create will enforce).
  const selectAgent = (agentId: string) => {
    setSelected(agentId);
    if (!agentId) { setLevel('readwrite'); return; }
    void window.jarvis.settingsGet(`permissions.${agentId}`).then((v) => {
      const saved = (v ?? {}) as { level?: SandboxLevel };
      if (saved.level) setLevel(saved.level);
    });
  };

  const save = async () => {
    if (!selected) return;
    await window.jarvis.settingsSet(`permissions.${selected}`, { level, allowCommands: [], allowDomains: [] });
  };

  return (
    <div data-testid="permissions-settings">
      <h2>{t('settings.title')}</h2>
      <label>
        {t('settings.permissions.agent')}
        <select data-testid="perm-agent" value={selected} onChange={e => selectAgent(e.target.value)}>
          <option value="">—</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <label>
        {t('settings.permissions.level')}
        <select data-testid="perm-level" value={level} onChange={e => setLevel(e.target.value as SandboxLevel)}>
          <option value="readonly">{t('settings.permissions.readonly')}</option>
          <option value="readwrite">{t('settings.permissions.readwrite')}</option>
          <option value="system">{t('settings.permissions.system')}</option>
        </select>
      </label>
      <button data-testid="perm-save" onClick={() => void save()}>{t('common.save')}</button>
    </div>
  );
}
