import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
// searchProvider is a pure renderer-safe module, so import its types from the
// renderer-safe entry (@jarvis/core/renderer) rather than the full barrel,
// which pulls Node deps. Type-only: the page never calls buildSearchRequest —
// main does the actual fetch via the webSearch helper.
import type { SearchProviderConfig, SearchProviderType } from '@jarvis/core/renderer';

const PROVIDER_TYPES: SearchProviderType[] = ['bing', 'brave', 'tavily', 'serper'];

// L25: 联网搜索源配置。Persists settings.search_providers as an array of
// SearchProviderConfig; the main-side webSearch helper routes web_search by the
// first enabled entry. Every window.jarvis call is wrapped so a rejected IPC
// surfaces inline instead of an unhandled rejection (Task 1 convention).
export function SearchProvidersPage() {
  const { t } = useTranslation('common');
  const [configs, setConfigs] = useState<SearchProviderConfig[]>([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const find = (type: SearchProviderType): SearchProviderConfig =>
    configs.find(c => c.type === type) ?? { type, apiKey: '', enabled: false };

  const refresh = useCallback(async () => {
    try {
      const v = await window.jarvis.settingsGet('search_providers');
      setConfigs(Array.isArray(v) ? v as SearchProviderConfig[] : []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const patch = (type: SearchProviderType, p: Partial<SearchProviderConfig>) => {
    setSaved(false);
    setConfigs(prev => prev.some(c => c.type === type)
      ? prev.map(c => c.type === type ? { ...c, ...p } : c)
      : [...prev, { type, apiKey: '', enabled: false, ...p }]);
  };

  const save = async () => {
    try {
      await window.jarvis.settingsSet('search_providers', configs);
      setSaved(true);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div data-testid="search-providers">
      <h2>{t('searchProviders.title')}</h2>
      {PROVIDER_TYPES.map(type => {
        const cfg = find(type);
        return (
          <div key={type} data-testid={`search-provider-${type}`} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ minWidth: 70 }}>{type}</span>
            <input
              data-testid={`search-provider-key-${type}`}
              type="password"
              value={cfg.apiKey}
              placeholder={t('searchProviders.apiKeyPlaceholder')}
              onChange={e => patch(type, { apiKey: e.target.value })}
            />
            <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input
                data-testid={`search-provider-enabled-${type}`}
                type="checkbox"
                checked={cfg.enabled}
                onChange={e => patch(type, { enabled: e.target.checked })}
              />
              {t('searchProviders.enabled')}
            </label>
          </div>
        );
      })}
      <button data-testid="search-providers-save" onClick={() => void save()}>{t('common.save')}</button>
      {saved && <div data-testid="search-providers-saved">{t('searchProviders.saved')}</div>}
      {error && <div data-testid="search-providers-error" role="alert">{error}</div>}
    </div>
  );
}
