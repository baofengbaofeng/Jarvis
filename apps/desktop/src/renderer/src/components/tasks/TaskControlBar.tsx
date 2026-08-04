import { useTranslation } from 'react-i18next';
import { useTaskStore } from '../../stores/task-store';

export function TaskControlBar() {
  const { t } = useTranslation('common');
  const { status, cancel, pause, resume, retry, logs } = useTaskStore();
  if (!status) return null;
  return (
    <div data-testid="task-control">
      <span data-testid="task-status">{status}</span>
      {status === 'running' && <button onClick={() => void cancel()}>{t('common.cancel')}</button>}
      {status === 'running' && <button onClick={() => void pause()}>⏸</button>}
      {status === 'paused' && <button onClick={() => void resume()}>▶</button>}
      {status === 'failed' && <button data-testid="task-retry" onClick={() => void retry()}>{t('common.ok')}</button>}
      <pre data-testid="task-logs">{logs.join('\n')}</pre>
    </div>
  );
}
