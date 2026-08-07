import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Panel } from '@jarvis/ui';

export interface BackupInfo { file: string; name: string; sizeBytes: number; createdAt: string }

export function BackupPane() {
  const { t } = useTranslation('common');
  const [list, setList] = useState<BackupInfo[]>([]);
  const refresh = async () => setList((await window.jarvis.invoke('backup.list')) as BackupInfo[]);
  useEffect(() => { void refresh(); }, []);
  const onBackupNow = async () => { await window.jarvis.invoke('backup.create'); await refresh(); };
  const onRestore = async (file: string) => {
    if (confirm(t('safety.restore_confirm'))) {
      await window.jarvis.invoke('backup.restore', file);
      void window.jarvis.invoke('app.relaunch');
    }
  };
  return (
    <div data-testid="backup-pane" className="form-stack">
      <Button variant="primary" onClick={() => void onBackupNow()} data-testid="backup-now">{t('safety.backup_now')}</Button>
      <ul className="settings-card-list">
        {list.map(b => (
          <li key={b.file}>
            <Panel className="settings-card" data-testid="backup-item">
              <div className="settings-card__header">
                <span>{b.name} · {(b.sizeBytes / 1024).toFixed(1)} KB</span>
                <Button variant="ghost" size="sm" onClick={() => void onRestore(b.file)}>{t('safety.restore')}</Button>
              </div>
            </Panel>
          </li>
        ))}
      </ul>
    </div>
  );
}
