import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Panel } from '@jarvis/ui';

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
    <Panel data-testid="skills-merger" className="settings-card">
      <h3 className="settings-card__title">{t('runtime.skillsMerger.title')}</h3>
      {pending.length === 0 && <p data-testid="no-conflicts" className="empty-text">{t('runtime.skillsMerger.none')}</p>}
      <ul className="settings-card-list">
        {pending.map((c) => (
          <li key={`${c.taskId}-${nameOf(c)}`} data-testid="conflict-item" className="settings-inline-row">
            <span className="settings-card__meta">{nameOf(c)}</span>
            <Button size="sm" variant="ghost" onClick={() => void resolve(c, 'local')}>{t('runtime.skillsMerger.local')}</Button>
            <Button size="sm" variant="ghost" onClick={() => void resolve(c, 'multica')}>{t('runtime.skillsMerger.multica')}</Button>
            <Button size="sm" variant="ghost" onClick={() => void resolve(c, 'merge')}>{t('runtime.skillsMerger.merge')}</Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
