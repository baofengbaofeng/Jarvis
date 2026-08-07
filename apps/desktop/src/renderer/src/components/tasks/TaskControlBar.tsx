import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '@jarvis/ui';
import { useTaskStore } from '../../stores/task-store';

export function TaskControlBar() {
  const { t } = useTranslation('common');
  const { status, cancel, pause, resume, retry, logs } = useTaskStore();
  const [showLogs, setShowLogs] = useState(true);
  if (!status) return null;
  return (
    <div data-testid="task-control" className="task-control">
      <span data-testid="task-status" className="task-control__status">{status}</span>
      {status === 'running' && (
        <Button variant="ghost" size="sm" data-testid="task-cancel" onClick={() => void cancel()}>
          {t('common.cancel')}
        </Button>
      )}
      {status === 'running' && (
        <IconButton label={t('board.pause')} size="sm" data-testid="task-pause" onClick={() => void pause()}>⏸</IconButton>
      )}
      {status === 'paused' && (
        <IconButton label={t('board.resume')} size="sm" data-testid="task-resume" onClick={() => void resume()}>▶</IconButton>
      )}
      {status === 'failed' && (
        <Button variant="ghost" size="sm" data-testid="task-retry" onClick={() => void retry()}>{t('board.retry')}</Button>
      )}
      <IconButton
        label={t('task.logs')}
        size="sm"
        data-testid="task-logs-toggle"
        onClick={() => setShowLogs((v) => !v)}
        className={showLogs ? 'task-control__logs-toggle--active' : undefined}
      >
        📋
      </IconButton>
      {showLogs && (
        <pre data-testid="task-logs" className="task-control__logs">{logs.join('\n')}</pre>
      )}
    </div>
  );
}
