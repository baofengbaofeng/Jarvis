import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProviderStore } from '../../stores/provider-store';

export function ProviderForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation('common');
  const create = useProviderStore((s) => s.create);
  const [name, setName] = useState('');
  const [type, setType] = useState<'openai-compatible' | 'anthropic-compatible'>('openai-compatible');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');

  const submit = async () => {
    await create({ name, type, baseUrl, apiKey });
    onDone();
  };

  return (
    <form data-testid="provider-form">
      <input data-testid="provider-name" placeholder={t('settings.provider.name')} value={name} onChange={e => setName(e.target.value)} />
      <select data-testid="provider-type" value={type} onChange={e => setType(e.target.value as typeof type)}>
        <option value="openai-compatible">{t('settings.provider.typeOpenai')}</option>
        <option value="anthropic-compatible">{t('settings.provider.typeAnthropic')}</option>
      </select>
      <input data-testid="provider-baseurl" placeholder={t('settings.provider.baseUrl')} value={baseUrl} onChange={e => setBaseUrl(e.target.value)} />
      <input data-testid="provider-apikey" type="password" placeholder={t('settings.provider.apiKey')} value={apiKey} onChange={e => setApiKey(e.target.value)} />
      <button type="button" data-testid="provider-save" onClick={() => void submit()}>{t('common.save')}</button>
    </form>
  );
}
