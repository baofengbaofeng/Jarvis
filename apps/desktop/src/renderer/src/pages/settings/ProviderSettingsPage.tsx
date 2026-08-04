import { useTranslation } from 'react-i18next';

export function ProviderSettingsPage() {
  const { t } = useTranslation('common');
  return (
    <div data-testid="provider-settings">
      <h2>{t('settings.provider.title')}</h2>
      <button>{t('settings.provider.add')}</button>
      <p data-testid="provider-empty">{t('settings.provider.empty')}</p>
    </div>
  );
}
