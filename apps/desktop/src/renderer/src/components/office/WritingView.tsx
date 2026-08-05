import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
// office/writing is a pure module, so import its types from the renderer-safe
// entry (@jarvis/core/renderer) rather than the full barrel, which pulls Node deps.
import type { WritingAction } from '@jarvis/core/renderer';

export function WritingView() {
  const { t } = useTranslation('common');
  const [text, setText] = useState('');
  const [live, setLive] = useState<{ done: string[]; pending: string } | null>(null);
  const [sideBySide, setSideBySide] = useState(false);
  const [error, setError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const runAction = async (action: WritingAction) => {
    if (!text.trim()) return;
    setError('');
    try {
      const r = (await window.jarvis.invoke('office.writing', { action, text })) as { ok: boolean; result?: string };
      if (r.ok && r.result) setText(r.result);
      // A non-ok response is still surfaced as an error so the user knows the
      // channel did not produce a result (e.g. no model binding).
      else setError(t('writing.error'));
    } catch {
      // The office channel rejects when no agent has a valid model binding or
      // the API key is missing (see main/ipc/office.ts). Surface it instead of
      // leaking an unhandled rejection to the console.
      setError(t('writing.error'));
    }
  };

  useEffect(() => {
    if (!sideBySide || !text.trim()) { setLive(null); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // Promise-chain (not await) so a rejecting channel cannot escape as an
      // unhandled rejection from the debounced effect; on error, clear the live
      // preview and leave the editor usable.
      window.jarvis.invoke('office.writing.translate', text, 'en')
        .then((r) => { const res = r as { ok: boolean; done: string[]; pending: string }; if (res.ok) setLive({ done: res.done, pending: res.pending }); })
        .catch(() => setLive(null));
    }, 800);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [text, sideBySide]);

  return (
    <div data-testid="writing-view">
      <textarea data-testid="writing-text" value={text} onChange={e => setText(e.target.value)} rows={12} />
      <div>
        <button data-testid="writing-polish" onClick={() => void runAction('polish')}>{t('writing.polish')}</button>
        <button data-testid="writing-continue" onClick={() => void runAction('continue')}>{t('writing.continue')}</button>
        <button data-testid="writing-summarize" onClick={() => void runAction('summarize')}>{t('writing.summarize')}</button>
        <button data-testid="writing-translate" onClick={() => void runAction('translate')}>{t('writing.translate')}</button>
        <label><input type="checkbox" data-testid="writing-live" checked={sideBySide} onChange={e => setSideBySide(e.target.checked)} /> {t('writing.live')}</label>
      </div>
      {live && <div data-testid="writing-live-result">{live.done.join('\n')}<span className="pending">{live.pending}</span></div>}
      {error && <div data-testid="writing-error">{error}</div>}
    </div>
  );
}
