import { useState } from 'react';
import { useTranslation } from 'react-i18next';

// D9 renderer entry: video link summary. URL → office.video.summarize. With
// getTranscript being a stub (Whisper/API out of scope for M5), the channel
// returns the clear "no transcript" error — displaying that inline is the CORRECT
// D9 no-silent-failure behavior, not a bug.
export function VideoSummary() {
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
      const r = (await window.jarvis.invoke('office.video.summarize', url.trim())) as { ok: boolean; result?: string; error?: string };
      if (r.ok) setResult(r.result ?? '');
      else setError(r.error ?? t('officeTools.error'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="video-summary">
      <input
        data-testid="video-url"
        value={url}
        onChange={e => setUrl(e.target.value)}
        placeholder={t('officeTools.videoUrlPlaceholder')}
        style={{ minWidth: 320 }}
      />
      <button data-testid="video-summarize" onClick={() => void summarize()} disabled={busy}>
        {t('officeTools.summarize')}
      </button>
      {error && <div data-testid="video-error" role="alert">{error}</div>}
      {result && <div data-testid="video-result" style={{ whiteSpace: 'pre-wrap' }}>{result}</div>}
    </div>
  );
}
