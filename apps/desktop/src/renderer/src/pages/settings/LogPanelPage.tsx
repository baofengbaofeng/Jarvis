import { useTranslation } from 'react-i18next';

export function LogPanelPage() {
  const { t } = useTranslation('common');
  return (
    <div data-testid="log-panel">
      <h2>{t('settings.title')}</h2>
      <pre data-testid="log-list">{t('common.loading')}</pre>
    </div>
  );
}
