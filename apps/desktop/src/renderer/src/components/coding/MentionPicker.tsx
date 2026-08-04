import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MentionCandidate } from '@jarvis/core';

export function MentionPicker({ onSelect, onClose }: { onSelect: (c: MentionCandidate) => void; onClose: () => void }) {
  const { t } = useTranslation('common');
  const [q, setQ] = useState('');
  const [cands, setCands] = useState<MentionCandidate[]>([]);
  useEffect(() => {
    if (!q) { setCands([]); return; }
    const t = setTimeout(async () => {
      const r = (await window.jarvis.invoke('mention.search', q)) as MentionCandidate[];
      setCands(r);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div data-testid="mention-picker">
      <input data-testid="mention-input" value={q} onChange={e => setQ(e.target.value)} autoFocus placeholder={t('mention.placeholder')} />
      <ul>{cands.map(c => (
        <li key={c.id}><button data-testid="mention-option" onClick={() => { onSelect(c); onClose(); }}>{c.label} <em>{c.kind}</em></button></li>
      ))}</ul>
    </div>
  );
}
