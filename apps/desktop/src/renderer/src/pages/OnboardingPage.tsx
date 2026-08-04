import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../stores/settings-store';

export function OnboardingPage({ onDone }: { onDone?: () => void }) {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const setOnboardingDone = useSettings((s) => s.setOnboardingDone);

  const next = () => setStep((s) => Math.min(3, s + 1));
  const finish = async () => {
    await setOnboardingDone(true);
    onDone?.();
    navigate('/', { replace: true });
  };

  return (
    <div data-testid="onboarding">
      <h1>{t('onboarding.title')}</h1>
      {step === 1 && <div data-testid="onboarding-step-1">{t('onboarding.step1')}</div>}
      {step === 2 && <div data-testid="onboarding-step-2">{t('onboarding.step2')}</div>}
      {step === 3 && <div data-testid="onboarding-step-3">{t('onboarding.step3')}</div>}
      {step < 3 && <button data-testid="onboarding-next" onClick={next}>{t('common.ok')}</button>}
      {step === 3 && <button data-testid="onboarding-finish" onClick={() => void finish()}>{t('onboarding.start')}</button>}
    </div>
  );
}
