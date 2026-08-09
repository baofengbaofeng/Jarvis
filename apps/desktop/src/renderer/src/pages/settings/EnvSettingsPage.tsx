import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, PageHeader, Select, Textarea } from '@jarvis/ui';
import { ENV_FIELD_MAX } from '@jarvis/protocol';
import { useAgentStore } from '../../stores/agent-store';

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function EnvSettingsPage() {
  const { t } = useTranslation('common');
  const { agents, refresh } = useAgentStore();
  const [agentId, setAgentId] = useState('');
  const [envText, setEnvText] = useState('');
  const [cliText, setCliText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => { void refresh(); }, [refresh]);

  const selectAgent = (id: string) => {
    setAgentId(id);
    setError(null);
    setStatus(null);
    const agent = agents.find(a => a.id === id);
    if (agent) {
      setEnvText(Object.entries(agent.envVars ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'));
      setCliText((agent.cliArgs ?? []).join(' '));
    } else {
      setEnvText('');
      setCliText('');
    }
  };

  const parseEnv = (): Record<string, string> | null => {
    const out: Record<string, string> = {};
    const lines = envText.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!line.trim()) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) {
        setError(t('settings.env.errors.envLineInvalid', { line: i + 1 }));
        return null;
      }
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (!KEY_PATTERN.test(key) || key.length > ENV_FIELD_MAX.key || value.length > ENV_FIELD_MAX.value) {
        setError(t('settings.env.errors.envLineInvalid', { line: i + 1 }));
        return null;
      }
      out[key] = value;
    }
    return out;
  };

  const save = async () => {
    setStatus(null);
    if (!agentId) {
      setError(t('settings.env.errors.agentRequired'));
      return;
    }
    if (envText.length > ENV_FIELD_MAX.envText) {
      setError(t('settings.env.errors.envTooLong'));
      return;
    }
    if (cliText.length > ENV_FIELD_MAX.cliText) {
      setError(t('settings.env.errors.cliTooLong'));
      return;
    }
    const envVars = parseEnv();
    if (!envVars) return;
    setError(null);
    try {
      await window.jarvis.invoke('agent.update', agentId, {
        envVars,
        cliArgs: cliText.split(/\s+/).filter(Boolean),
      });
      setStatus(t('settings.env.saved'));
    } catch {
      setError(t('settings.env.errors.saveFailed'));
    }
  };

  return (
    <div data-testid="env-settings" className="page form-stack settings-page">
      <PageHeader title={t('settings.env.title')} subtitle={t('settings.env.subtitle')} />
      <div className="form-field">
        <label htmlFor="env-agent">{t('settings.env.agent')}</label>
        <p className="form-field__hint">{t('settings.env.agentHint')}</p>
        <Select id="env-agent" data-testid="env-agent" value={agentId} onChange={e => selectAgent(e.target.value)}>
          <option value="">—</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      </div>
      <div className="form-field">
        <label htmlFor="env-text">{t('settings.env.envVars')}</label>
        <p className="form-field__hint">{t('settings.env.envHint')}</p>
        <Textarea
          id="env-text"
          data-testid="env-text"
          value={envText}
          maxLength={ENV_FIELD_MAX.envText}
          onChange={e => { setEnvText(e.target.value); setError(null); }}
          placeholder={t('settings.env.placeholder')}
        />
      </div>
      <div className="form-field">
        <label htmlFor="env-cli">{t('settings.env.cliArgs')}</label>
        <p className="form-field__hint">{t('settings.env.cliHint')}</p>
        <Textarea
          id="env-cli"
          data-testid="env-cli"
          value={cliText}
          maxLength={ENV_FIELD_MAX.cliText}
          onChange={e => { setCliText(e.target.value); setError(null); }}
          placeholder={t('settings.env.cliPlaceholder')}
        />
      </div>
      {error ? <p data-testid="env-error" role="alert" className="form-field__error">{error}</p> : null}
      {status ? <p data-testid="env-status" className="form-field__hint">{status}</p> : null}
      <Button variant="primary" data-testid="env-save" onClick={() => void save()}>{t('common.save')}</Button>
    </div>
  );
}
