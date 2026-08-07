import { useTranslation } from 'react-i18next';
import { Button } from '@jarvis/ui';
import { useTaskStore } from '../../stores/task-store';

export function TaskControlBar() {
  const { t } = useTranslation('common');
  const { status, cancel, pause, resume, retry, logs } = useTaskStore();
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
        <Button variant="ghost" size="sm" data-testid="task-pause" onClick={() => void pause()}>⏸</Button>
      )}
      {status === 'paused' && (
        <Button variant="ghost" size="sm" data-testid="task-resume" onClick={() => void resume()}>▶</Button>
      )}
      {status === 'failed' && (
        <Button variant="ghost" size="sm" data-testid="task-retry" onClick={() => void retry()}>{t('common.ok')}</Button>
      )}
      <pre data-testid="task-logs" className="task-control__logs">{logs.join('\n')}</pre>
    </div>
  );
}
