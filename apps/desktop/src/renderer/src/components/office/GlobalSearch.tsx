import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Panel } from '@jarvis/ui';
// FtsRow is a pure type exported from the renderer-safe entry (@jarvis/core/renderer).
import type { FtsRow } from '@jarvis/core/renderer';

const TABLES = ['message', 'agent', 'task'] as const;

// L21 renderer entry: global FTS5 search across chat_messages/agents/tasks.
// query → search.global; results are grouped by table with title + snippet. Every
// invoke is wrapped so a rejection or a non-ok response surfaces inline.
export function GlobalSearch() {
  const { t } = useTranslation('common');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FtsRow[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const search = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setError('');
    setDone(false);
    setResults([]);
    try {
      const r = (await window.jarvis.invoke('search.global', { query: query.trim() })) as { ok: boolean; results?: FtsRow[]; error?: string };
      if (r.ok) {
        setResults(r.results ?? []);
        setDone(true);
      } else {
        setError(r.error ?? t('officeTools.error'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel data-testid="global-search" className="office-tool">
      <div className="office-tool__row">
        <Input
          data-testid="global-search-query"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('officeTools.queryPlaceholder')}
          className="office-tool__input"
        />
        <Button data-testid="global-search-run" onClick={() => void search()} disabled={busy}>
          {t('officeTools.search')}
        </Button>
      </div>
      {error && <div data-testid="global-search-error" role="alert" className="error-text">{error}</div>}
      {done && results.length === 0 && !error && <div data-testid="global-search-empty" className="empty-text">{t('officeTools.noResult')}</div>}
      <div data-testid="global-search-results">
        {TABLES.map(table => {
          const rows = results.filter(r => r.table === table);
          if (rows.length === 0) return null;
          return (
            <div key={table} data-testid={`global-search-group-${table}`} className="office-tool__group">
              <h4 className="office-tool__group-title">{t(`officeTools.table.${table}`)}</h4>
              {rows.map(r => (
                <div key={`${r.table}-${r.id}`} data-testid={`global-search-item-${table}-${r.id}`} className="office-tool__item">
                  <strong>{r.title || `#${r.id}`}</strong>
                  <div className="office-tool__result">{r.snippet}</div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
