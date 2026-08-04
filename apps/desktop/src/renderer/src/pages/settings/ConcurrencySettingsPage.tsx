import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export function ConcurrencySettingsPage() {
  const { t } = useTranslation('common');
  const [perAgent, setPerAgent] = useState(6);
  const [machine, setMachine] = useState(20);
  useEffect(() => {
    void window.jarvis.settingsGet('concurrency').then((v) => {
      const c = (v ?? {}) as { perAgent?: number; machine?: number };
      if (c.perAgent !== undefined) setPerAgent(c.perAgent);
      if (c.machine !== undefined) setMachine(c.machine);
    });
  }, []);
  const save = async () => {
    await window.jarvis.settingsSet('concurrency', { perAgent, machine });
    await window.jarvis.invoke('daemon.restart');
  };
  return (
    <div data-testid="concurrency-settings">
      <h2>{t('settings.title')}</h2>
      <label>
        {t('settings.concurrency.perAgent')}{' '}
        <input data-testid="concurrency-peragent" type="number" value={perAgent} onChange={e => setPerAgent(Number(e.target.value))} />
      </label>
      <label>
        {t('settings.concurrency.machine')}{' '}
        <input data-testid="concurrency-machine" type="number" value={machine} onChange={e => setMachine(Number(e.target.value))} />
      </label>
      <button data-testid="concurrency-save" onClick={() => void save()}>{t('common.save')}</button>
    </div>
  );
}
