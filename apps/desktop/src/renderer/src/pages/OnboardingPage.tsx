import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, PageHeader } from '@jarvis/ui';
import { JarvisMark } from '../components/brand/JarvisMark';
import { useSettings } from '../stores/settings-store';
import { useAgentStore } from '../stores/agent-store';
import { IpcChannel, PROVIDER_FIELD_MAX, sanitizeProviderNameInput } from '@jarvis/protocol';

export function OnboardingPage({ onDone }: { onDone?: () => void }) {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [providerName, setProviderName] = useState('');
  const [providerUrl, setProviderUrl] = useState('');
  const [providerApiKey, setProviderApiKey] = useState('');
  const [agentName, setAgentName] = useState('');
  const [diag, setDiag] = useState<Array<{ id: string; ok: boolean; detail: string }>>([]);
  const setOnboardingDone = useSettings((s) => s.setOnboardingDone);
  const createAgent = useAgentStore((s) => s.create);

  useEffect(() => {
    if (step === 3) {
      void window.jarvis.invoke('diagnostics.run').then((r) => {
        const report = r as { items?: Array<{ id: string; ok: boolean; detail: string }> };
        setDiag(report.items ?? []);
      });
    }
  }, [step]);

  const next = () => setStep((s) => Math.min(3, s + 1));

  const saveProvider = async () => {
    if (!providerName.trim() || !providerUrl.trim() || !providerApiKey.trim()) return;
    const res = await window.jarvis.invoke(IpcChannel.providerCreate, {
      name: providerName.trim(),
      type: 'openai-compatible',
      baseUrl: providerUrl.trim(),
      apiKey: providerApiKey.trim(),
    }) as { ok?: boolean; error?: string } | { id: string };
    if (res && typeof res === 'object' && 'ok' in res && res.ok === false) return;
    next();
  };

  const saveAgent = async () => {
    if (!agentName.trim()) return;
    await createAgent({ name: agentName.trim(), systemPrompt: t('onboarding.defaultPrompt'), modelId: null, workspaceId: null });
    next();
  };

  const finish = async () => {
    await setOnboardingDone(true);
    onDone?.();
    navigate('/', { replace: true });
  };

  return (
    <div data-testid="onboarding" className="onboarding">
      <div className="onboarding__card">
        <div className="onboarding__brand" data-testid="onboarding-brand">
          <JarvisMark size="lg" variant="app" />
          <p className="onboarding__brand-sub">{t('app.subtitle')}</p>
        </div>
        <PageHeader title={t('onboarding.title')} subtitle={t('onboarding.subtitle', { step })} />
        <div className="onboarding__steps" aria-hidden>
          {[1, 2, 3].map(n => <span key={n} className={`onboarding__dot${step >= n ? ' onboarding__dot--active' : ''}`} />)}
        </div>
        {step === 1 && (
          <div data-testid="onboarding-step-1" className="onboarding-step form-stack">
            <label className="form-field">
              <span>{t('settings.provider.name')}</span>
              <input
                value={providerName}
                maxLength={PROVIDER_FIELD_MAX.name}
                onChange={e => setProviderName(sanitizeProviderNameInput(e.target.value))}
              />
            </label>
            <label className="form-field">
              <span>{t('settings.provider.baseUrl')}</span>
              <input
                value={providerUrl}
                maxLength={PROVIDER_FIELD_MAX.baseUrl}
                onChange={e => setProviderUrl(e.target.value)}
              />
            </label>
            <label className="form-field">
              <span>{t('settings.provider.apiKey')}</span>
              <input
                type="password"
                data-testid="onboarding-apikey"
                value={providerApiKey}
                maxLength={PROVIDER_FIELD_MAX.apiKey}
                onChange={e => setProviderApiKey(e.target.value)}
              />
            </label>
            <Button variant="primary" data-testid="onboarding-next" onClick={() => void saveProvider()}>{t('common.ok')}</Button>
          </div>
        )}
        {step === 2 && (
          <div data-testid="onboarding-step-2" className="onboarding-step form-stack">
            <label className="form-field">
              <span>{t('agent.name')}</span>
              <input value={agentName} onChange={e => setAgentName(e.target.value)} />
            </label>
            <Button variant="primary" data-testid="onboarding-next" onClick={() => void saveAgent()}>{t('common.ok')}</Button>
          </div>
        )}
        {step === 3 && (
          <div data-testid="onboarding-step-3" className="onboarding-step">
            <ul className="onboarding-diag">
              {diag.map(item => (
                <li key={item.id} className={item.ok ? 'onboarding-diag__ok' : 'onboarding-diag__bad'}>
                  <strong>{item.id}</strong> — {item.detail}
                </li>
              ))}
            </ul>
            <Button variant="primary" data-testid="onboarding-finish" onClick={() => void finish()}>{t('onboarding.start')}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
