import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../stores/agent-store';

export function EnvSettingsPage() {
  const { t } = useTranslation('common');
  const { agents, refresh } = useAgentStore();
  const [agentId, setAgentId] = useState('');
  const [envText, setEnvText] = useState('');
  const [cliText, setCliText] = useState('');
  useEffect(() => { void refresh(); }, [refresh]);

  // Each line "KEY=value"; the first '=' splits key from value so values may
  // contain '=' (e.g. base64 or URLs).
  const parse = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const line of envText.split('\n')) { const i = line.indexOf('='); if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
    return out;
  };

  // C9: CLI args are whitespace-tokenized into an argv array, matching the
  // `cli_args_json` shape AgentEngine / tools consume.
  const save = async () => {
    if (!agentId) return;
    await window.jarvis.invoke('agent.update', agentId, { envVars: parse(), cliArgs: cliText.split(/\s+/).filter(Boolean) });
  };

  return (
    <div data-testid="env-settings">
      <h2>{t('settings.title')}</h2>
      <label>
        {t('settings.env.agent')}
        <select data-testid="env-agent" value={agentId} onChange={e => setAgentId(e.target.value)}>
          <option value="">—</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <label>{t('settings.env.envVars')}
        <textarea data-testid="env-text" value={envText} onChange={e => setEnvText(e.target.value)} placeholder={t('settings.env.placeholder')} />
      </label>
      <label>{t('settings.env.cliArgs')}
        <textarea data-testid="env-cli" value={cliText} onChange={e => setCliText(e.target.value)} placeholder={t('settings.env.cliPlaceholder')} />
      </label>
      <button data-testid="env-save" onClick={() => void save()}>{t('common.save')}</button>
    </div>
  );
}
