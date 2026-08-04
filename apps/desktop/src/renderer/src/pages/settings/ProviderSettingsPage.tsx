import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
    <div data-testid={`provider-models-${providerId}`}>
      <h4 style={{ margin: '8px 0 4px', fontSize: 12 }}>{t('settings.provider.models')}</h4>
      <ul>
        {models.map((m) => (
          <li key={m.id} data-testid={`provider-model-${m.id}`}>
            {m.modelId}{m.name && m.name !== m.modelId ? ` — ${m.name}` : ''}
          </li>
        ))}
      </ul>
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <input data-testid="provider-model-id" placeholder={t('settings.provider.modelId')} value={modelId} onChange={(e) => setModelId(e.target.value)} />
        <input data-testid="provider-model-name" placeholder={t('settings.provider.modelName')} value={name} onChange={(e) => setName(e.target.value)} />
        <button data-testid="provider-model-add" onClick={() => void add()}>{t('settings.provider.addModel')}</button>
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
    <div data-testid="provider-settings">
      <h2>{t('settings.provider.title')}</h2>
      <button data-testid="provider-add-open" onClick={() => setShowForm(true)}>{t('settings.provider.add')}</button>
      {showForm && <ProviderForm onDone={() => setShowForm(false)} />}
      {providers.length === 0 && !showForm && <p data-testid="provider-empty">{t('settings.provider.empty')}</p>}
      <ul>
        {providers.map(p => (
          <li key={p.id}>
            <span>{p.name}</span> ({p.type})
            <button onClick={() => void remove(p.id)}>{t('settings.provider.remove')}</button>
            <ProviderModels providerId={p.id} />
          </li>
        ))}
      </ul>
    </div>
  );
}
