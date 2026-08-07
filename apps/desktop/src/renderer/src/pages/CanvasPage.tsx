import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader, Select } from '@jarvis/ui';
import { boardOrder } from '@jarvis/core/renderer';
import { CanvasView } from '../components/canvas/CanvasView';
import { useTaskboardStore } from '../stores/taskboard-store';
import { useTaskStore } from '../stores/task-store';

export function CanvasPage() {
  const { t } = useTranslation('common');
  const cols = useTaskboardStore((s) => s.cols);
  const load = useTaskboardStore((s) => s.load);
  const activeTaskId = useTaskStore((s) => s.activeTaskId);
  const [taskId, setTaskId] = useState<string | undefined>();

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (activeTaskId) setTaskId(activeTaskId);
  }, [activeTaskId]);

  const tasks = useMemo(
    () => boardOrder().flatMap((status) => cols[status]),
    [cols],
  );

  return (
    <div data-testid="canvas-page" className="page page--wide canvas-page">
      <PageHeader
        title={t('canvas.title')}
        actions={(
          <Select
            data-testid="canvas-task-select"
            value={taskId ?? ''}
            onChange={(e) => setTaskId(e.target.value || undefined)}
          >
            <option value="">{t('canvas.selectTask')}</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>{task.id}</option>
            ))}
          </Select>
        )}
      />
      <CanvasView taskId={taskId} />
    </div>
  );
}
