import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SelectionAction } from '@jarvis/core';

const ACTIONS: Array<{ key: SelectionAction; label: string }> = [
  { key: 'translate', label: '译' }, { key: 'explain', label: '释' },
  { key: 'summarize', label: '总' }, { key: 'search', label: '搜' }
];

export function SelectionMenu() {
  const { t } = useTranslation('common');
  const [pos, setPos] = useState<{ x: number; y: number; text: string } | null>(null);
  const [result, setResult] = useState<string>('');
  const root = useRef<HTMLDivElement>(null);

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
    const r = (await window.jarvis.invoke('office.selection', { text: pos.text, action })) as { ok: boolean; result?: string };
    if (r.ok) setResult(r.result ?? '');
    setPos(null);
  };

  return (
    <div ref={root} data-testid="selection-menu">
      {pos && (
        <div className="selection-menu" style={{ left: pos.x, top: pos.y }}>
          {ACTIONS.map(a => <button key={a.key} data-testid={`sel-${a.key}`} onClick={() => void run(a.key)}>{t(`selection.${a.key}`, a.label)}</button>)}
        </div>
      )}
      {result && <div data-testid="selection-result" className="selection-result">{result}</div>}
    </div>
  );
}
