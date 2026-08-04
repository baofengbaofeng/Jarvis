import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface DaemonStatus {
  running: boolean;
  version: string;
  activeTasks: number;
  queued: number;
  perAgent: number;
  concurrency: number;
}

export function DaemonManagementPage() {
  const { t } = useTranslation('common');
  const [status, setStatus] = useState<DaemonStatus>({
    running: false,
    version: '-',
    activeTasks: 0,
    queued: 0,
    perAgent: 0,
    concurrency: 0
  });
  const refresh = async () => setStatus((await window.jarvis.invoke('daemon.status')) as DaemonStatus);
  useEffect(() => {
    void refresh();
    const iv = setInterval(() => void refresh(), 3000);
    return () => clearInterval(iv);
  }, []);
  const restart = async () => {
    await window.jarvis.invoke('daemon.restart');
    void refresh();
  };

  return (
    <div data-testid="daemon-management">
      <h2>Daemon</h2>
      <p data-testid="daemon-running">{status.running ? `● ${t('daemon.running')}` : `○ ${t('daemon.stopped')}`}</p>
      <p data-testid="daemon-version">{t('daemon.version')} {status.version}</p>
      <p data-testid="daemon-tasks">{t('daemon.active')} {status.activeTasks} / {t('daemon.queued')} {status.queued}</p>
      <p data-testid="daemon-limits">{t('daemon.perAgent')} {status.perAgent} / {t('daemon.concurrency')} {status.concurrency}</p>
      <button data-testid="daemon-restart" onClick={() => void restart()}>{t('menu.restart')}</button>
    </div>
  );
}
