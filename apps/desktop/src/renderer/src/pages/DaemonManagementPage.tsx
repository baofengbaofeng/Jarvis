import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RuntimeStatusView } from '../components/runtime/RuntimeStatusView';
import { SkillsMerger } from '../components/runtime/SkillsMerger';

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
      <h2>{t('daemon.title')}</h2>
      <p data-testid="daemon-running">{status.running ? `● ${t('daemon.running')}` : `○ ${t('daemon.stopped')}`}</p>
      <p data-testid="daemon-version">{t('daemon.version')} {status.version}</p>
      <p data-testid="daemon-tasks">{t('daemon.active')} {status.activeTasks} / {t('daemon.queued')} {status.queued}</p>
      <p data-testid="daemon-limits">{t('daemon.perAgent')} {status.perAgent} / {t('daemon.concurrency')} {status.concurrency}</p>
      <button data-testid="daemon-restart" onClick={() => void restart()}>{t('menu.restart')}</button>
      {/* M7 Task 10: the daemon management page is the natural home for the
          Multica runtime surfaces (prototype 13). RuntimeStatusView (L39) polls
          runtime.status every 3s via the runtime-store; SkillsMerger (L38) lists
          runtime.conflicts and writes runtime.resolveConflict. Both degrade to an
          empty state when the runtime isn't reachable, so they are safe to mount
          here even when the daemon isn't registered with a Multica server. */}
      <RuntimeStatusView />
      <SkillsMerger />
    </div>
  );
}
