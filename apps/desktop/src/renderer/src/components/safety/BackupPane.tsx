import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, EmptyState, Modal, ModalMessage } from '@jarvis/ui';

export interface BackupInfo { file: string; name: string; sizeBytes: number; createdAt: string }

export function BackupPane() {
  const { t } = useTranslation('common');
  const [list, setList] = useState<BackupInfo[]>([]);
  const [restoring, setRestoring] = useState<BackupInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = async () => setList((await window.jarvis.invoke('backup.list')) as BackupInfo[]);
  useEffect(() => { void refresh(); }, []);
  const onBackupNow = async () => { await window.jarvis.invoke('backup.create'); await refresh(); };

  const columns = [
    {
      key: 'name',
      header: t('safety.backupName'),
      render: (b: BackupInfo) => (
        <span data-testid="backup-item">{b.name} · {(b.sizeBytes / 1024).toFixed(1)} KB</span>
      ),
    },
    {
      key: 'actions',
      header: t('safety.restore'),
      render: (b: BackupInfo) => (
        <Button variant="ghost" size="sm" data-testid={`backup-restore-${b.file}`} onClick={() => setRestoring(b)}>
          {t('safety.restore')}
        </Button>
      ),
    },
  ];

  return (
    <div data-testid="backup-pane" className="form-stack">
      <Button variant="primary" onClick={() => void onBackupNow()} data-testid="backup-now">{t('safety.backup_now')}</Button>
      {list.length === 0 ? (
        <EmptyState title={t('safety.backupEmpty')} description={t('safety.backupEmptyHint')} />
      ) : (
        <DataTable columns={columns} rows={list} rowKey={(b) => b.file} />
      )}
      <Modal
        open={restoring != null}
        title={t('safety.restoreTitle')}
        testId="backup-restore-modal"
        onClose={() => { if (!busy) setRestoring(null); }}
        actions={
          <>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRestoring(null)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              size="sm"
              data-testid="backup-restore-confirm"
              disabled={busy}
              onClick={() => {
                if (!restoring) return;
                setBusy(true);
                void window.jarvis
                  .invoke('backup.restore', restoring.file)
                  .then(() => window.jarvis.invoke('app.relaunch'))
                  .finally(() => setBusy(false));
              }}
            >
              {t('safety.restore')}
            </Button>
          </>
        }
      >
        {restoring ? <ModalMessage>{t('safety.restore_confirm')}</ModalMessage> : null}
      </Modal>
    </div>
  );
}
