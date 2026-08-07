import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, PageHeader, Panel } from '@jarvis/ui';
import type { Model } from '@jarvis/protocol';
import { useProviderStore } from '../../stores/provider-store';
import { ProviderForm } from './ProviderForm';

function ProviderModels({ providerId }: { providerId: string }) {
  const { t } = useTranslation('common');
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState('');
  const [name, setName] = useState('');

  const refresh = useCallback(async () => {
    const ms = (await window.jarvis.invoke('provider.listModels', providerId)) as Model[];
    setModels(ms);
  }, [providerId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = async () => {
    const id = modelId.trim();
    if (!id) return;
    await window.jarvis.invoke('provider.addModel', providerId, { modelId: id, name: name.trim() || id });
    setModelId('');
    setName('');
    await refresh();
  };

  return (
    <div data-testid={`provider-models-${providerId}`} className="form-stack form-stack--spaced">
      <h4 className="settings-card__meta">{t('settings.provider.models')}</h4>
      <ul className="settings-card-list">
        {models.map((m) => (
          <li key={m.id} data-testid={`provider-model-${m.id}`} className="settings-card__meta">
            {m.modelId}{m.name && m.name !== m.modelId ? ` — ${m.name}` : ''}
          </li>
        ))}
      </ul>
      <div className="settings-inline-row">
        <Input data-testid="provider-model-id" placeholder={t('settings.provider.modelId')} value={modelId} onChange={(e) => setModelId(e.target.value)} />
        <Input data-testid="provider-model-name" placeholder={t('settings.provider.modelName')} value={name} onChange={(e) => setName(e.target.value)} />
        <Button variant="primary" size="sm" data-testid="provider-model-add" onClick={() => void add()}>{t('settings.provider.addModel')}</Button>
      </div>
    </div>
  );
}

export function ProviderSettingsPage() {
  const { t } = useTranslation('common');
  const { providers, refresh, remove } = useProviderStore();
  const [showForm, setShowForm] = useState(false);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div data-testid="provider-settings" className="page settings-page">
      <PageHeader
        title={t('settings.provider.title')}
        actions={<Button variant="primary" data-testid="provider-add-open" onClick={() => setShowForm(true)}>{t('settings.provider.add')}</Button>}
      />
      {showForm && <ProviderForm onDone={() => setShowForm(false)} />}
      {providers.length === 0 && !showForm && <p data-testid="provider-empty" className="empty-text">{t('settings.provider.empty')}</p>}
      <ul className="settings-card-list">
        {providers.map(p => (
          <li key={p.id}>
            <Panel className="settings-card">
              <div className="settings-card__header">
                <div>
                  <div className="settings-card__title">{p.name}</div>
                  <div className="settings-card__meta">{p.type}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => void remove(p.id)}>{t('settings.provider.remove')}</Button>
              </div>
              <ProviderModels providerId={p.id} />
            </Panel>
          </li>
        ))}
      </ul>
    </div>
  );
}
