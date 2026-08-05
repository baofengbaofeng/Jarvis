import { useEffect } from 'react';
import { useTaskboardStore } from '../../stores/taskboard-store';
import { boardOrder } from '@jarvis/core/renderer';

export function TaskBoard() {
  const cols = useTaskboardStore(s => s.cols);
  const load = useTaskboardStore(s => s.load);
  const { cancel, pause, resume, retry } = useTaskboardStore();
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="task-board" data-testid="task-board">
      {boardOrder().map(status => (
        <section key={status} className="task-board__col" data-testid={`col-${status}`}>
          <h3>{status} ({cols[status].length})</h3>
          {cols[status].map(task => (
            <article key={task.id} className="task-card" data-testid="task-card">
              <div className="task-card__id">{task.id}</div>
              <div className="task-card__agent">{task.agentId ?? '—'}</div>
              {task.status === 'running' && <button onClick={() => void pause(task.id)}>⏸</button>}
              {task.status === 'running' && <button onClick={() => void cancel(task.id)}>✕</button>}
              {task.status === 'queued' && <button onClick={() => void cancel(task.id)}>✕</button>}
              {task.status === 'paused' && <button onClick={() => void resume(task.id)}>▶</button>}
              {task.status === 'failed' && <button onClick={() => void retry(task.id)}>↻</button>}
              {task.error && <div className="task-card__error">{task.error}</div>}
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
