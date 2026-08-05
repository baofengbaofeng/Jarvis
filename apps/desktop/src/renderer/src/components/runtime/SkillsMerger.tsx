import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface ConflictItem {
  taskId: string;
  skill?: { name: string; localPath?: string; multicaPath?: string };
  mcp?: { name: string; localCommand?: string; multicaCommand?: string };
  resolved: boolean;
}

export function SkillsMerger() {
  const { t } = useTranslation('common');
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  // Task 1 convention: an IPC failure (or a null/absent response when the
  // daemon page mounts this without a runtime) must not throw mid-render — keep
  // the last-known list and degrade to "no conflicts".
  const refresh = async () => {
    try {
      const res = (await window.jarvis.invoke('runtime.conflicts')) as ConflictItem[] | null;
      setConflicts(res ?? []);
    } catch (e) {
      console.error('runtime.conflicts failed', e);
    }
  };
  useEffect(() => { void refresh(); }, []);
  const nameOf = (c: ConflictItem) => c.skill?.name ?? c.mcp?.name ?? '';
  const resolve = async (c: ConflictItem, decision: 'local' | 'multica' | 'merge') => {
    try {
      await window.jarvis.invoke('runtime.resolveConflict', { name: nameOf(c), decision });
      void refresh();
    } catch (e) {
      console.error('runtime.resolveConflict failed', e);
    }
  };
  const pending = conflicts.filter((c) => !c.resolved);
  return (
    <div data-testid="skills-merger">
      <h3>{t('runtime.skillsMerger.title')}</h3>
      {pending.length === 0 && <p data-testid="no-conflicts">{t('runtime.skillsMerger.none')}</p>}
      <ul>
        {pending.map((c) => (
          <li key={`${c.taskId}-${nameOf(c)}`} data-testid="conflict-item">
            <span>{nameOf(c)}</span>
            <button onClick={() => void resolve(c, 'local')}>{t('runtime.skillsMerger.local')}</button>
            <button onClick={() => void resolve(c, 'multica')}>{t('runtime.skillsMerger.multica')}</button>
            <button onClick={() => void resolve(c, 'merge')}>{t('runtime.skillsMerger.merge')}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
