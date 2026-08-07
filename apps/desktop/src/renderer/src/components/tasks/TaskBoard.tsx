import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton, PageHeader, StatusBadge } from '@jarvis/ui';
import { useTaskboardStore } from '../../stores/taskboard-store';
import { boardOrder } from '@jarvis/core/renderer';

const STATUS_LABEL: Record<string, 'queued' | 'running' | 'completed' | 'failed' | 'paused' | 'cancelled'> = {
  queued: 'queued',
  running: 'running',
  paused: 'paused',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
};

export function TaskBoard() {
  const { t } = useTranslation('common');
  const cols = useTaskboardStore(s => s.cols);
  const load = useTaskboardStore(s => s.load);
  const { cancel, pause, resume, retry } = useTaskboardStore();
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="page page--wide">
      <PageHeader title={t('board.title')} subtitle={t('board.subtitle')} />
      <div className="task-board" data-testid="task-board">
        {boardOrder().map(status => (
          <section key={status} className="task-board__col" data-testid={`col-${status}`}>
            <div className="task-board__col-head">
              <StatusBadge status={STATUS_LABEL[status] ?? 'default'}>{t(`board.col.${status}`)}</StatusBadge>
              <span className="task-board__count">{cols[status].length}</span>
            </div>
            <div className="task-board__cards">
              {cols[status].map(task => (
                <article key={task.id} className="task-card" data-testid="task-card">
                  <div className="task-card__title">{task.id}</div>
                  <div className="task-card__agent">{task.agentId ?? '—'}</div>
                  <div className="task-card__actions">
                    {task.status === 'running' && (
                      <>
                        <IconButton label={t('board.pause')} onClick={() => void pause(task.id)}>⏸</IconButton>
                        <IconButton label={t('board.cancel')} variant="danger" onClick={() => void cancel(task.id)}>✕</IconButton>
                      </>
                    )}
                    {task.status === 'queued' && (
                      <IconButton label={t('board.cancel')} variant="danger" onClick={() => void cancel(task.id)}>✕</IconButton>
                    )}
                    {task.status === 'paused' && (
                      <IconButton label={t('board.resume')} onClick={() => void resume(task.id)}>▶</IconButton>
                    )}
                    {task.status === 'failed' && (
                      <IconButton label={t('board.retry')} onClick={() => void retry(task.id)}>↻</IconButton>
                    )}
                  </div>
                  {task.error && <div className="task-card__error">{task.error}</div>}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
