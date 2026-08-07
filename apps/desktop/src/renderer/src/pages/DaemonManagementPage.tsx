import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Panel } from '@jarvis/ui';
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
    <div data-testid="daemon-management" className="page form-stack">
      <h2 className="page__title">{t('daemon.title')}</h2>
      <Panel className="form-stack">
        <p data-testid="daemon-running" className={`status-badge ${status.running ? 'status-badge--running' : 'status-badge--stopped'}`}>
          {status.running ? `● ${t('daemon.running')}` : `○ ${t('daemon.stopped')}`}
        </p>
        <p data-testid="daemon-version" className="settings-card__meta">{t('daemon.version')} {status.version}</p>
        <p data-testid="daemon-tasks" className="settings-card__meta">{t('daemon.active')} {status.activeTasks} / {t('daemon.queued')} {status.queued}</p>
        <p data-testid="daemon-limits" className="settings-card__meta">{t('daemon.perAgent')} {status.perAgent} / {t('daemon.concurrency')} {status.concurrency}</p>
        <Button variant="primary" data-testid="daemon-restart" onClick={() => void restart()}>{t('menu.restart')}</Button>
      </Panel>
      <section data-testid="injection-approvals" className="form-stack">
        <h3 className="page__title">{t('daemon.injectionApprovals.title')}</h3>
        {approvals.length === 0 ? (
          <p data-testid="injection-approvals-empty" className="empty-text">{t('daemon.injectionApprovals.none')}</p>
        ) : (
          <ul className="settings-card-list" data-testid="injection-approvals-list">
            {approvals.map((item) => (
              <li key={`${item.kind}:${item.name}:${item.digest}`}>
                <Panel className="settings-card" data-testid={`injection-approval-${item.digest}`}>
                  <div className="settings-card__header">
                    <div>
                      <Badge data-testid="injection-source">{t('daemon.injectionApprovals.source')}</Badge>
                      <span data-testid="injection-name"> {item.name}</span>
                      <div data-testid="injection-digest" className="settings-card__meta">{item.digest}</div>
                    </div>
                    <Button variant="ghost" size="sm" data-testid={`injection-approve-${item.digest}`} onClick={() => void approve(item)}>
                      {t('daemon.injectionApprovals.approve')}
                    </Button>
                  </div>
                </Panel>
              </li>
            ))}
          </ul>
        )}
        {retryHint ? <p data-testid="injection-retry-hint" className="settings-card__meta">{retryHint}</p> : null}
      </section>
      <RuntimeStatusView />
      <SkillsMerger />
    </div>
  );
}
