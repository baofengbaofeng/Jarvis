import { useState } from 'react';
import { useTranslation } from 'react-i18next';

// D8/I8 renderer entry: one-click web page summary. URL → office.webview.summarize
// (main opens the session-isolated WebView, extracts the page, drains it through
// chatText, and closes). Every invoke is wrapped so a rejection or a non-ok
// response surfaces inline instead of an unhandled promise rejection (Task 1
// convention).
export function WebViewSummary() {
  const { t } = useTranslation('common');
  const [url, setUrl] = useState('');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const summarize = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setError('');
    setResult('');
    try {
      const r = (await window.jarvis.invoke('office.webview.summarize', url.trim())) as { ok: boolean; result?: string; error?: string };
      if (r.ok) setResult(r.result ?? '');
      else setError(r.error ?? t('officeTools.error'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="webview-summary">
      <input
        data-testid="webview-url"
        value={url}
        onChange={e => setUrl(e.target.value)}
        placeholder={t('officeTools.urlPlaceholder')}
        style={{ minWidth: 320 }}
      />
      <button data-testid="webview-summarize" onClick={() => void summarize()} disabled={busy}>
        {t('officeTools.summarize')}
      </button>
      {error && <div data-testid="webview-error" role="alert">{error}</div>}
      {result && <div data-testid="webview-result" style={{ whiteSpace: 'pre-wrap' }}>{result}</div>}
    </div>
  );
}
