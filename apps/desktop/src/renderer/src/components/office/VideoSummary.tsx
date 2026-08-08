import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Panel } from '@jarvis/ui';

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
    <Panel data-testid="video-summary" className="office-tool">
      <div className="office-tool__row">
        <Input
          data-testid="video-url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder={t('officeTools.videoUrlPlaceholder')}
          className="office-tool__input"
        />
        <Button data-testid="video-summarize" onClick={() => void summarize()} disabled={busy}>
          {t('officeTools.summarize')}
        </Button>
      </div>
      {error && <div data-testid="video-error" role="alert" className="error-text">{error}</div>}
      {result && <div data-testid="video-result" className="office-tool__result" data-selection-menu>{result}</div>}
    </Panel>
  );
}
