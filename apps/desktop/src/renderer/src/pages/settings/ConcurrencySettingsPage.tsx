import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, PageHeader } from '@jarvis/ui';
import { CONCURRENCY_FIELD_MAX } from '@jarvis/protocol';
import { FieldInput } from '../../components/settings/FieldInput';

type FieldKey = 'perAgent' | 'machine' | 'form';

export function ConcurrencySettingsPage() {
  const { t } = useTranslation('common');
  const [perAgent, setPerAgent] = useState('6');
  const [machine, setMachine] = useState('20');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void window.jarvis.settingsGet('concurrency').then((v) => {
      const c = (v ?? {}) as { perAgent?: number; machine?: number };
      if (c.perAgent !== undefined) setPerAgent(String(c.perAgent));
      if (c.machine !== undefined) setMachine(String(c.machine));
    });
  }, []);

  const parsePositiveInt = (raw: string): number | null => {
    if (!/^\d+$/.test(raw.trim())) return null;
    const n = Number(raw.trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  };

  const save = async () => {
    setStatus(null);
    const pa = parsePositiveInt(perAgent);
    if (pa == null) {
      setFieldErrors({ perAgent: t('settings.concurrency.errors.perAgentInvalid') });
      return;
    }
    if (pa < CONCURRENCY_FIELD_MAX.perAgentMin || pa > CONCURRENCY_FIELD_MAX.perAgentMax) {
      setFieldErrors({
        perAgent: t('settings.concurrency.errors.perAgentRange', {
          min: CONCURRENCY_FIELD_MAX.perAgentMin,
          max: CONCURRENCY_FIELD_MAX.perAgentMax,
        }),
      });
      return;
    }
    const m = parsePositiveInt(machine);
    if (m == null) {
      setFieldErrors({ machine: t('settings.concurrency.errors.machineInvalid') });
      return;
    }
    if (m < CONCURRENCY_FIELD_MAX.machineMin || m > CONCURRENCY_FIELD_MAX.machineMax) {
      setFieldErrors({
        machine: t('settings.concurrency.errors.machineRange', {
          min: CONCURRENCY_FIELD_MAX.machineMin,
          max: CONCURRENCY_FIELD_MAX.machineMax,
        }),
      });
      return;
    }
    if (m < pa) {
      setFieldErrors({ machine: t('settings.concurrency.errors.machineGtePerAgent') });
      return;
    }
    setFieldErrors({});
    try {
      await window.jarvis.settingsSet('concurrency', { perAgent: pa, machine: m });
      await window.jarvis.invoke('daemon.restart');
      setStatus(t('settings.concurrency.saved'));
    } catch {
      setFieldErrors({ form: t('settings.concurrency.errors.saveFailed') });
    }
  };

  return (
    <div data-testid="concurrency-settings" className="page form-stack settings-page">
      <PageHeader
        title={t('settings.concurrency.title')}
        subtitle={t('settings.concurrency.subtitle')}
      />
      <div className="form-field">
        <label htmlFor="concurrency-peragent">{t('settings.concurrency.perAgent')}</label>
        <p className="form-field__hint" title={t('settings.concurrency.perAgentHint')}>
          {t('settings.concurrency.perAgentHint')}
        </p>
        <FieldInput
          id="concurrency-peragent"
          data-testid="concurrency-peragent"
          inputMode="numeric"
          value={perAgent}
          maxLength={3}
          error={fieldErrors.perAgent}
          errorTestId="concurrency-peragent-error"
          onChange={(e) => {
            setPerAgent(e.target.value.replace(/\D/g, ''));
            setFieldErrors((prev) => {
              const next = { ...prev };
              delete next.perAgent;
              return next;
            });
          }}
        />
      </div>
      <div className="form-field">
        <label htmlFor="concurrency-machine">{t('settings.concurrency.machine')}</label>
        <p className="form-field__hint" title={t('settings.concurrency.machineHint')}>
          {t('settings.concurrency.machineHint')}
        </p>
        <FieldInput
          id="concurrency-machine"
          data-testid="concurrency-machine"
          inputMode="numeric"
          value={machine}
          maxLength={3}
          error={fieldErrors.machine}
          errorTestId="concurrency-machine-error"
          onChange={(e) => {
            setMachine(e.target.value.replace(/\D/g, ''));
            setFieldErrors((prev) => {
              const next = { ...prev };
              delete next.machine;
              return next;
            });
          }}
        />
      </div>
      {fieldErrors.form ? (
        <p data-testid="concurrency-form-error" role="alert" className="form-field__error">{fieldErrors.form}</p>
      ) : null}
      {status ? <p data-testid="concurrency-status" className="form-field__hint">{status}</p> : null}
      <Button variant="primary" data-testid="concurrency-save" onClick={() => void save()}>
        {t('common.save')}
      </Button>
    </div>
  );
}
