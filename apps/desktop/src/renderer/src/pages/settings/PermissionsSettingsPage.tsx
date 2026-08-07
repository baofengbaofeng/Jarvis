import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, PageHeader, Select } from '@jarvis/ui';
import { useAgentStore } from '../../stores/agent-store';

export type SandboxLevel = 'readonly' | 'readwrite' | 'system';

export function PermissionsSettingsPage() {
  const { t } = useTranslation('common');
  const { agents, refresh } = useAgentStore();
  const [selected, setSelected] = useState<string>('');
  const [level, setLevel] = useState<SandboxLevel>('readwrite');
  useEffect(() => { void refresh(); }, [refresh]);

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
    <div data-testid="permissions-settings" className="page form-stack settings-page">
      <PageHeader title={t('settings.nav.permissions')} />
      <div className="form-field">
        <label htmlFor="perm-agent">{t('settings.permissions.agent')}</label>
        <Select id="perm-agent" data-testid="perm-agent" value={selected} onChange={e => selectAgent(e.target.value)}>
          <option value="">—</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      </div>
      <div className="form-field">
        <label htmlFor="perm-level">{t('settings.permissions.level')}</label>
        <Select id="perm-level" data-testid="perm-level" value={level} onChange={e => setLevel(e.target.value as SandboxLevel)}>
          <option value="readonly">{t('settings.permissions.readonly')}</option>
          <option value="readwrite">{t('settings.permissions.readwrite')}</option>
          <option value="system">{t('settings.permissions.system')}</option>
        </Select>
      </div>
      <Button variant="primary" data-testid="perm-save" onClick={() => void save()}>{t('common.save')}</Button>
    </div>
  );
}
