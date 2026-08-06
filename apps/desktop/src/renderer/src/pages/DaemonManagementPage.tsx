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

export interface InjectionApprovalItem {
  kind: string;
  name: string;
  digest: string;
  taskId: string;
  createdAt: string;
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
  const [approvals, setApprovals] = useState<InjectionApprovalItem[]>([]);
  const [retryHint, setRetryHint] = useState<string | null>(null);
  const refresh = async () => setStatus((await window.jarvis.invoke('daemon.status')) as DaemonStatus);
  const refreshApprovals = async () => {
    const res = (await window.jarvis.invoke('daemon.injectionApprovals.list')) as
      | { ok: true; items: InjectionApprovalItem[] }
      | { ok: false; error: string };
    if (res && res.ok) setApprovals(res.items);
    else setApprovals([]);
  };
  useEffect(() => {
    void refresh();
    void refreshApprovals();
    const iv = setInterval(() => {
      void refresh();
      void refreshApprovals();
    }, 3000);
    return () => clearInterval(iv);
  }, []);
  const restart = async () => {
    await window.jarvis.invoke('daemon.restart');
    void refresh();
  };
  const approve = async (item: InjectionApprovalItem) => {
    const res = (await window.jarvis.invoke('daemon.injectionApprovals.approve', {
      kind: item.kind,
      name: item.name,
      digest: item.digest,
    })) as { ok: boolean; error?: string };
    if (res.ok) {
      setRetryHint(t('daemon.injectionApprovals.retryHint'));
      void refreshApprovals();
    }
  };

  return (
    <div data-testid="daemon-management">
      <h2>{t('daemon.title')}</h2>
      <p data-testid="daemon-running">{status.running ? `● ${t('daemon.running')}` : `○ ${t('daemon.stopped')}`}</p>
      <p data-testid="daemon-version">{t('daemon.version')} {status.version}</p>
      <p data-testid="daemon-tasks">{t('daemon.active')} {status.activeTasks} / {t('daemon.queued')} {status.queued}</p>
      <p data-testid="daemon-limits">{t('daemon.perAgent')} {status.perAgent} / {t('daemon.concurrency')} {status.concurrency}</p>
      <button data-testid="daemon-restart" onClick={() => void restart()}>{t('menu.restart')}</button>
      <section data-testid="injection-approvals">
        <h3>{t('daemon.injectionApprovals.title')}</h3>
        {approvals.length === 0 ? (
          <p data-testid="injection-approvals-empty">{t('daemon.injectionApprovals.none')}</p>
        ) : (
          <ul data-testid="injection-approvals-list">
            {approvals.map((item) => (
              <li key={`${item.kind}:${item.name}:${item.digest}`} data-testid={`injection-approval-${item.digest}`}>
                <span data-testid="injection-source">{t('daemon.injectionApprovals.source')}</span>
                <span data-testid="injection-name">{item.name}</span>
                <span data-testid="injection-digest">{item.digest}</span>
                <button
                  data-testid={`injection-approve-${item.digest}`}
                  onClick={() => void approve(item)}
                >
                  {t('daemon.injectionApprovals.approve')}
                </button>
              </li>
            ))}
          </ul>
        )}
        {retryHint ? <p data-testid="injection-retry-hint">{retryHint}</p> : null}
      </section>
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
