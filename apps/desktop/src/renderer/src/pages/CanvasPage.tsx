import { useTranslation } from 'react-i18next';
import { CanvasView } from '../components/canvas/CanvasView';

// K6 (M8 Task 10): /canvas route — canvas workspace rendering task artifacts.
// Without a taskId the view shows the empty state (acceptable for the
// acceptance "渲染"); the data plane (artifacts.list) is task-scoped, so real
// content requires a task id (the task-completion path in main persists rows).
export function CanvasPage() {
  const { t } = useTranslation('common');
  return (
    <div data-testid="canvas-page" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <h1 style={{ padding: '8px 12px', borderBottom: '1px solid var(--border, #eee)', fontSize: 16, margin: 0 }}>{t('canvas.title')}</h1>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        <CanvasView />
      </div>
    </div>
  );
}
