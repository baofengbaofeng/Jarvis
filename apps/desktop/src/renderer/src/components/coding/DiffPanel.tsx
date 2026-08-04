import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { diffLines, groupHunks } from '@jarvis/core';

export function DiffPanel({ taskId, path, base, modified }: { taskId: string; path: string; base: string; modified: string }) {
  const { t } = useTranslation('common');
  const hunks = useMemo(() => groupHunks(diffLines(base.split('\n'), modified.split('\n'))), [base, modified]);
  const [decisions, setDecisions] = useState<Array<'accept' | 'reject' | null>>(hunks.map(() => null));
  // Reset per-hunk decisions whenever the diff changes. Without this, a mounted
  // (non-keyed) DiffPanel that switches from file A to file B would carry A's
  // stale decisions: `allDone` would already be true, the Apply button would
  // show, and `accepts` (A's length) would silently reject B's undecided hunks.
  // (review fix)
  useEffect(() => { setDecisions(hunks.map(() => null)); }, [base, modified, hunks]);
  const allDone = decisions.every(d => d !== null);

  const decide = (i: number, d: 'accept' | 'reject') => {
    const next = [...decisions]; next[i] = d; setDecisions(next);
  };
  const commit = async () => {
    const accepts = decisions.map(d => d === 'accept');
    await window.jarvis.invoke('diff.applyAll', { taskId, path, accepts });
    window.dispatchEvent(new CustomEvent('jarvis:refresh-tree'));
  };

  return (
    <div data-testid="diff-panel">
      <div className="diff-panel__path">{path}</div>
      {hunks.map((h, i) => (
        <div key={i} data-testid={`hunk-${i}`} className="diff-hunk">
          <span>@@ -{h.oldStart},{h.oldLines} +{h.newStart},{h.newLines} @@</span>
          {h.lines.map((l, j) => (
            <div key={j} className={`diff-line diff-line--${l.type}`}>{l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '} {l.text}</div>
          ))}
          <button data-testid={`hunk-${i}-accept`} onClick={() => decide(i, 'accept')}>{t('diff.accept')}</button>
          <button data-testid={`hunk-${i}-reject`} onClick={() => decide(i, 'reject')}>{t('diff.reject')}</button>
        </div>
      ))}
      {allDone && <button data-testid="diff-commit" onClick={() => void commit()}>{t('diff.apply')}</button>}
    </div>
  );
}
