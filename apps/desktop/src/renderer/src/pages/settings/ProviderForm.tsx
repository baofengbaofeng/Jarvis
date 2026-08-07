import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Panel, Select } from '@jarvis/ui';
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
    <Panel elevated className="form-stack" data-testid="provider-form">
      <div className="form-field">
        <label htmlFor="provider-name">{t('settings.provider.name')}</label>
        <Input id="provider-name" data-testid="provider-name" value={name} onChange={e => setName(e.target.value)} />
      </div>
      <div className="form-field">
        <label htmlFor="provider-type">{t('settings.provider.typeOpenai')}</label>
        <Select id="provider-type" data-testid="provider-type" value={type} onChange={e => setType(e.target.value as typeof type)}>
          <option value="openai-compatible">{t('settings.provider.typeOpenai')}</option>
          <option value="anthropic-compatible">{t('settings.provider.typeAnthropic')}</option>
        </Select>
      </div>
      <div className="form-field">
        <label htmlFor="provider-baseurl">{t('settings.provider.baseUrl')}</label>
        <Input id="provider-baseurl" data-testid="provider-baseurl" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} />
      </div>
      <div className="form-field">
        <label htmlFor="provider-apikey">{t('settings.provider.apiKey')}</label>
        <Input id="provider-apikey" data-testid="provider-apikey" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} />
      </div>
      <Button variant="primary" data-testid="provider-save" onClick={() => void submit()}>{t('common.save')}</Button>
    </Panel>
  );
}
