import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface BackupInfo { file: string; name: string; sizeBytes: number; createdAt: string }

// L18 (M8 Task 4): backup management UI. Lists existing backups, creates a new
// one on demand, and restores a chosen backup. Restore closes the db in main,
// so after it succeeds the app relaunches immediately via app.relaunch.
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
    <div data-testid="backup-pane">
      <button onClick={() => void onBackupNow()} data-testid="backup-now">{t('safety.backup_now')}</button>
      <ul>
        {list.map(b => (
          <li key={b.file} data-testid="backup-item">
            {b.name} · {(b.sizeBytes / 1024).toFixed(1)} KB
            <button onClick={() => void onRestore(b.file)}>{t('safety.restore')}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
