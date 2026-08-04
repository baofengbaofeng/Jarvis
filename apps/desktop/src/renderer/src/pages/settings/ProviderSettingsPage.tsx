import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProviderStore } from '../../stores/provider-store';
import { ProviderForm } from './ProviderForm';

export function ProviderSettingsPage() {
  const { t } = useTranslation('common');
  const { providers, refresh, remove } = useProviderStore();
  const [showForm, setShowForm] = useState(false);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div data-testid="provider-settings">
      <h2>{t('settings.provider.title')}</h2>
      <button data-testid="provider-add-open" onClick={() => setShowForm(true)}>{t('settings.provider.add')}</button>
      {showForm && <ProviderForm onDone={() => setShowForm(false)} />}
      {providers.length === 0 && !showForm && <p data-testid="provider-empty">{t('settings.provider.empty')}</p>}
      <ul>
        {providers.map(p => (
          <li key={p.id}>
            <span>{p.name}</span> ({p.type})
            <button onClick={() => void remove(p.id)}>{t('common.cancel')}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
