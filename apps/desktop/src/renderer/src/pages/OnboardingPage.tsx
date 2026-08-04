import { useTranslation } from 'react-i18next';

// Placeholder until Task 13 implements the real 3-step onboarding wizard.
export function OnboardingPage() {
  const { t } = useTranslation('common');
  return <div data-testid="onboarding">{t('onboarding.title')}</div>;
}
