import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
// office/selection is a pure module, so import it from the renderer-safe entry
// (@jarvis/core/renderer) rather than the full barrel, which pulls Node deps.
import type { SelectionAction } from '@jarvis/core/renderer';

const ACTIONS: Array<{ key: SelectionAction; label: string }> = [
  { key: 'translate', label: '译' }, { key: 'explain', label: '释' },
  { key: 'summarize', label: '总' }, { key: 'search', label: '搜' }
];

export function SelectionMenu() {
  const { t } = useTranslation('common');
  const [pos, setPos] = useState<{ x: number; y: number; text: string } | null>(null);
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const onMouseUp = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? '';
      if (text.length > 0) setPos({ x: sel!.getRangeAt(0).getBoundingClientRect().right + 8, y: sel!.getRangeAt(0).getBoundingClientRect().top, text });
      else setPos(null);
    };
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, []);

  const run = async (action: SelectionAction) => {
    if (!pos) return;
    const text = pos.text;
    setError('');
    try {
      const r = (await window.jarvis.invoke('office.selection', { text, action })) as { ok: boolean; result?: string };
      if (r.ok) setResult(r.result ?? '');
      // A non-ok response is still surfaced as an error so the user knows the
      // analysis channel did not produce a result (e.g. no model binding).
      else setError(t('selection.error'));
    } catch {
      // The office channel rejects when no agent has a valid model binding or
      // the API key is missing (see main/ipc/office.ts). Surface it instead of
      // leaking an unhandled rejection to the console.
      setError(t('selection.error'));
    } finally {
      // Always dismiss the floating menu, success or failure, so it never stays
      // stuck open on an errored action.
      setPos(null);
    }
  };

  return (
    <div data-testid="selection-menu">
      {pos && (
        <div className="selection-menu" style={{ left: pos.x, top: pos.y }}>
          {ACTIONS.map(a => <button key={a.key} data-testid={`sel-${a.key}`} onClick={() => void run(a.key)}>{t(`selection.${a.key}`, a.label)}</button>)}
        </div>
      )}
      {result && <div data-testid="selection-result" className="selection-result">{result}</div>}
      {error && <div data-testid="selection-error" className="selection-error">{error}</div>}
    </div>
  );
}
