import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, PageHeader, Select, Textarea } from '@jarvis/ui';
import { useAgentStore } from '../../stores/agent-store';

export function EnvSettingsPage() {
  const { t } = useTranslation('common');
  const { agents, refresh } = useAgentStore();
  const [agentId, setAgentId] = useState('');
  const [envText, setEnvText] = useState('');
  const [cliText, setCliText] = useState('');
  useEffect(() => { void refresh(); }, [refresh]);

  const selectAgent = (id: string) => {
    setAgentId(id);
    const agent = agents.find(a => a.id === id);
    if (agent) {
      setEnvText(Object.entries(agent.envVars ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'));
      setCliText((agent.cliArgs ?? []).join(' '));
    } else {
      setEnvText('');
      setCliText('');
    }
  };

  const parse = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const line of envText.split('\n')) { const i = line.indexOf('='); if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
    return out;
  };

  const save = async () => {
    if (!agentId) return;
    await window.jarvis.invoke('agent.update', agentId, { envVars: parse(), cliArgs: cliText.split(/\s+/).filter(Boolean) });
  };

  return (
    <div data-testid="env-settings" className="page form-stack settings-page">
      <PageHeader title={t('settings.nav.env')} />
      <div className="form-field">
        <label htmlFor="env-agent">{t('settings.env.agent')}</label>
        <Select id="env-agent" data-testid="env-agent" value={agentId} onChange={e => selectAgent(e.target.value)}>
          <option value="">—</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      </div>
      <div className="form-field">
        <label htmlFor="env-text">{t('settings.env.envVars')}</label>
        <Textarea id="env-text" data-testid="env-text" value={envText} onChange={e => setEnvText(e.target.value)} placeholder={t('settings.env.placeholder')} />
      </div>
      <div className="form-field">
        <label htmlFor="env-cli">{t('settings.env.cliArgs')}</label>
        <Textarea id="env-cli" data-testid="env-cli" value={cliText} onChange={e => setCliText(e.target.value)} placeholder={t('settings.env.cliPlaceholder')} />
      </div>
      <Button variant="primary" data-testid="env-save" onClick={() => void save()}>{t('common.save')}</Button>
    </div>
  );
}
