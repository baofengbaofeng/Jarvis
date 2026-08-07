import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '@jarvis/ui';

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
    <div data-testid="concurrency-settings" className="form-stack">
      <h2 className="page__title">{t('settings.title')}</h2>
      <div className="form-field">
        <label htmlFor="concurrency-peragent">{t('settings.concurrency.perAgent')}</label>
        <Input id="concurrency-peragent" data-testid="concurrency-peragent" type="number" value={perAgent} onChange={e => setPerAgent(Number(e.target.value))} />
      </div>
      <div className="form-field">
        <label htmlFor="concurrency-machine">{t('settings.concurrency.machine')}</label>
        <Input id="concurrency-machine" data-testid="concurrency-machine" type="number" value={machine} onChange={e => setMachine(Number(e.target.value))} />
      </div>
      <Button variant="primary" data-testid="concurrency-save" onClick={() => void save()}>{t('common.save')}</Button>
    </div>
  );
}
