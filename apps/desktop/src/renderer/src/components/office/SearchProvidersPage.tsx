import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Panel } from '@jarvis/ui';
import type { SearchProviderType } from '@jarvis/core/renderer';

const PROVIDER_TYPES: SearchProviderType[] = ['bing', 'brave', 'tavily', 'serper'];

interface SearchProviderView {
  type: SearchProviderType;
  enabled: boolean;
  hasKey: boolean;
}

interface SearchProviderDraft extends SearchProviderView {
  /** Ephemeral user input — never loaded from main. */
  apiKey: string;
}

// L25: 联网搜索源配置。Credentials persist as apiKeyRef in settings with the
// actual key in SecureStorage; the renderer only sees hasKey and sends apiKey on
// save when the user enters a new value.
export function SearchProvidersPage() {
  const { t } = useTranslation('common');
  const [configs, setConfigs] = useState<SearchProviderDraft[]>([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const find = (type: SearchProviderType): SearchProviderDraft =>
    configs.find(c => c.type === type) ?? { type, apiKey: '', enabled: false, hasKey: false };

  const refresh = useCallback(async () => {
    try {
      const res = await window.jarvis.invoke('search.providers.get') as { ok: boolean; configs?: SearchProviderView[]; error?: string };
      if (!res.ok) throw new Error(res.error ?? 'search.providers.get failed');
      const loaded = res.configs ?? [];
      setConfigs(PROVIDER_TYPES.map(type => {
        const cfg = loaded.find(c => c.type === type);
        return { type, apiKey: '', enabled: cfg?.enabled ?? false, hasKey: cfg?.hasKey ?? false };
      }));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const patch = (type: SearchProviderType, p: Partial<SearchProviderDraft>) => {
    setSaved(false);
    setConfigs(prev => prev.map(c => c.type === type ? { ...c, ...p } : c));
  };

  const save = async () => {
    try {
      const payload = configs.map(({ type, enabled, apiKey }) => ({
        type,
        enabled,
        ...(apiKey ? { apiKey } : {}),
      }));
      const res = await window.jarvis.invoke('search.providers.set', payload) as { ok: boolean; error?: string };
      if (!res.ok) throw new Error(res.error ?? 'search.providers.set failed');
      setSaved(true);
      setError('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div data-testid="search-providers" className="page">
      <h2 className="page__title">{t('searchProviders.title')}</h2>
      <ul className="settings-card-list">
        {PROVIDER_TYPES.map(type => {
          const cfg = find(type);
          return (
            <li key={type}>
              <Panel data-testid={`search-provider-${type}`} className="settings-card">
                <div className="settings-inline-row">
                  <span className="settings-card__title search-provider-type">{type}</span>
                  <Input
                    data-testid={`search-provider-key-${type}`}
                    type="password"
                    value={cfg.apiKey}
                    placeholder={cfg.hasKey ? '••••••••' : t('searchProviders.apiKeyPlaceholder')}
                    onChange={e => patch(type, { apiKey: e.target.value })}
                    className="office-tool__input"
                  />
                  <label className="checkbox-label">
                    <input
                      data-testid={`search-provider-enabled-${type}`}
                      type="checkbox"
                      checked={cfg.enabled}
                      onChange={e => patch(type, { enabled: e.target.checked })}
                    />
                    {t('searchProviders.enabled')}
                  </label>
                </div>
              </Panel>
            </li>
          );
        })}
      </ul>
      <div className="page__actions">
        <Button variant="primary" data-testid="search-providers-save" onClick={() => void save()}>{t('common.save')}</Button>
      </div>
      {saved && <div data-testid="search-providers-saved" className="empty-text">{t('searchProviders.saved')}</div>}
      {error && <div data-testid="search-providers-error" role="alert" className="error-text">{error}</div>}
    </div>
  );
}
